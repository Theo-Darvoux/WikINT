"""Upload status endpoints: config, check-exists, batch-status, history, cancel."""

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import BadRequestError
from app.core.mimetypes import ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES
from app.core.redis import get_redis
from app.core.storage import delete_object
from app.dependencies.auth import CurrentUser
from app.routers.upload.helpers import _QUOTA_KEY_PREFIX, _STATUS_CACHE_PREFIX
from app.schemas.material import (
    BatchStatusRequest,
    CheckExistsOut,
    CheckExistsRequest,
    UploadHistoryItem,
    UploadHistoryOut,
    UploadStatus,
)

logger = logging.getLogger("wikint")

router = APIRouter()


# ── GET /api/upload/config ───────────────────────────────────────────────────


class UploadConfigOut(BaseModel):
    allowed_extensions: list[str]
    allowed_mimetypes: list[str]
    max_file_size_mb: int
    recommended_path: str       # "direct" | "tus"
    direct_threshold_mb: int    # files below this size → use direct path


@router.get("/config", response_model=UploadConfigOut)
async def get_upload_config() -> UploadConfigOut:
    """Return the current upload configuration (allowed types, size limits, recommended path).

    Clients should use ``recommended_path`` and ``direct_threshold_mb`` to decide
    which upload path to use without hard-coding the thresholds.
    """
    from app.config import settings

    return UploadConfigOut(
        allowed_extensions=sorted(list(ALLOWED_EXTENSIONS)),
        allowed_mimetypes=sorted(list(ALLOWED_MIME_TYPES)),
        max_file_size_mb=settings.max_file_size_mb,
        recommended_path="direct",
        direct_threshold_mb=settings.direct_upload_threshold_mb,
    )


# ── DELETE /api/upload/{upload_id} ───────────────────────────────────────────


@router.delete("/{upload_id}", status_code=204)
async def cancel_upload(
    upload_id: str,
    user: CurrentUser,
    redis: Annotated[Redis, Depends(get_redis)],
) -> None:
    """Cancel a pending or in-progress upload.

    Sets a Redis cancellation flag so the background worker aborts between
    stages, then deletes the quarantine object from S3 and removes it from
    the user's quota sorted set. Idempotent -- returns 204 even if the
    upload_id is not found.
    """
    user_id = str(user.id)

    # Signal the worker to abort between stages (1-hour TTL as safety net)
    cancel_key = f"upload:cancel:{upload_id}"
    await redis.set(cancel_key, "1", ex=3600)

    quota_key = f"{_QUOTA_KEY_PREFIX}{user_id}"
    quarantine_prefix = f"quarantine/{user_id}/{upload_id}/"
    uploads_prefix = f"uploads/{user_id}/{upload_id}/"  # audit fix #6

    members: list[bytes] = await redis.zrange(quota_key, 0, -1)
    target_key: str | None = None
    for raw in members:
        key = raw.decode() if isinstance(raw, bytes) else str(raw)
        if key.startswith(quarantine_prefix) or key.startswith(uploads_prefix):
            target_key = key
            break

    if target_key is None:
        return

    try:
        await delete_object(target_key)
    except Exception:
        pass

    await redis.zrem(quota_key, target_key)


# ── POST /api/upload/check-exists ────────────────────────────────────────────


@router.post("/check-exists", response_model=CheckExistsOut)
async def check_file_exists(
    data: CheckExistsRequest,
    user: CurrentUser,
    redis: Annotated[Redis, Depends(get_redis)],
) -> CheckExistsOut:
    """Check whether an identical file (by SHA-256) has already been processed."""
    user_id = str(user.id)

    sha256_cache_key = f"upload:sha256:{user_id}:{data.sha256}"
    cached = await redis.get(sha256_cache_key)
    if cached:
        file_key = cached.decode() if isinstance(cached, bytes) else str(cached)
        from app.core.storage import object_exists

        if await object_exists(file_key):
            return CheckExistsOut(exists=True, file_key=file_key)

    # ── Global CAS fallback (Audit Fix #15) ──
    # Return exists=True but WITHOUT a raw cas/ key to avoid leaking
    # internal storage paths.  The upload flow's CAS-hit path will handle
    # the actual copy from CAS to the per-user prefix.
    from app.core.cas import hmac_cas_key
    cas_key = hmac_cas_key(data.sha256)
    cas_raw = await redis.get(cas_key)
    if cas_raw:
        cas_data = json.loads(cas_raw)
        file_key = cas_data.get("final_key")
        if file_key:
            from app.core.storage import object_exists

            if await object_exists(file_key):
                await redis.set(sha256_cache_key, file_key, ex=24 * 3600)
                # Signal that the file exists but let the upload path
                # handle the per-user copy — don't expose internal keys
                return CheckExistsOut(exists=True, file_key=None)

    return CheckExistsOut(exists=False, file_key=None)


# ── POST /api/upload/status/batch ────────────────────────────────────────────


@router.post("/status/batch")
async def batch_upload_status(
    data: BatchStatusRequest,
    user: CurrentUser,
    redis: Annotated[Redis, Depends(get_redis)],
) -> dict:
    """Poll the processing status for up to 50 file keys in a single request."""
    user_id_str = str(user.id)

    # Filter keys to only those belonging to the user (prefix match, NOT substring)
    owned_keys: list[str] = []
    for fk in data.file_keys:
        fk_str = str(fk)
        if (
            fk_str.startswith(f"quarantine/{user_id_str}/")
            or fk_str.startswith(f"uploads/{user_id_str}/")
        ):
            owned_keys.append(fk_str)

    results: dict[str, dict] = {}
    if not owned_keys:
        return {"statuses": results}

    # Fetch statuses from Redis
    cache_keys = [f"{_STATUS_CACHE_PREFIX}{k}" for k in owned_keys]
    values = await redis.mget(*cache_keys)

    for file_key, cached in zip(owned_keys, values):
        if cached:
            try:
                results[file_key] = json.loads(cached)
            except Exception:
                results[file_key] = {"file_key": file_key, "status": UploadStatus.PENDING}
        else:
            results[file_key] = {"file_key": file_key, "status": UploadStatus.PENDING}

    return {"statuses": results}


# ── GET /api/upload/mine ─────────────────────────────────────────────────────


@router.get("/mine", response_model=UploadHistoryOut)
async def list_my_uploads(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
) -> UploadHistoryOut:
    """Return the authenticated user's paginated upload history.

    Results are ordered by creation time descending (most recent first).
    All statuses are included (pending, processing, clean, failed, malicious).
    """
    from sqlalchemy import func, select

    from app.models.upload import Upload

    total = await db.scalar(
        select(func.count()).select_from(Upload).where(Upload.user_id == user.id)
    ) or 0

    result = await db.execute(
        select(Upload)
        .where(Upload.user_id == user.id)
        .order_by(Upload.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    rows = result.scalars().all()

    return UploadHistoryOut(
        items=[
            UploadHistoryItem(
                upload_id=row.upload_id,
                filename=row.filename,
                mime_type=row.mime_type,
                size_bytes=row.size_bytes,
                status=row.status,
                sha256=row.sha256,
                final_key=row.final_key,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in rows
        ],
        total=total,
        page=page,
        pages=max(1, (total + limit - 1) // limit),
    )


# ── Deprecated stubs ─────────────────────────────────────────────────────────


@router.post("/request-url", deprecated=True)
async def request_upload_url_deprecated() -> None:
    raise BadRequestError(
        "This endpoint has been removed. Use POST /api/upload/init for presigned uploads "
        "or POST /api/upload for direct uploads."
    )

"""Upload shared helpers: quota enforcement, DB row creation, job enqueueing."""

import logging
import time
from uuid import UUID

from redis.asyncio import Redis

import app.core.redis as redis_core
from app.core.database import async_session_factory
from app.core.exceptions import BadRequestError
from app.core.upload_errors import ERR_QUOTA_EXCEEDED

logger = logging.getLogger("wikint")

MAX_PENDING_UPLOADS = 50
MAX_PENDING_UPLOADS_PRIVILEGED = 200
LARGE_FILE_THRESHOLD = 50 * 1024 * 1024  # 50 MiB
LARGE_SVG_THRESHOLD = LARGE_FILE_THRESHOLD  # alias used by tests

_FAST_QUEUE_THRESHOLD = 5 * 1024 * 1024  # 5 MiB
_FAST_QUEUE_NAME = "upload-fast"
_SLOW_QUEUE_NAME = "upload-slow"

_QUOTA_KEY_PREFIX = "quota:uploads:"
_IDEM_KEY_PREFIX = "upload:idem:"
_IDEM_TTL = 25 * 3600  # 25 h -- slightly longer than the 24 h file TTL
_UPLOAD_INTENT_PREFIX = "upload:intent:"
_UPLOAD_INTENT_TTL = 3600  # 1 h to complete a presigned upload
_STATUS_CACHE_PREFIX = "upload:status:"


async def _create_upload_row(
    upload_id: str,
    user_id: str,
    quarantine_key: str,
    filename: str,
    mime_type: str,
    size_bytes: int,
    status: str = "pending",
) -> None:
    """Persist an upload lifecycle row. Mandatory: raises on failure."""
    from app.models.upload import Upload

    async with async_session_factory() as session:
        row = Upload(
            upload_id=upload_id,
            user_id=UUID(user_id),
            quarantine_key=quarantine_key,
            filename=filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            status=status,
        )
        session.add(row)
        await session.commit()


async def _check_pending_cap(
    user_id: str,
    redis: "Redis[bytes]",
    *,
    privileged: bool = False,
    reserve_key: str | None = None,
) -> None:
    """Raise if the user has hit the pending-upload ceiling.

    Optionally reserves ``reserve_key`` atomically to prevent TOCTOU races.
    Fail-closed: if Redis is unreachable, we reject the upload.
    """
    cap = MAX_PENDING_UPLOADS_PRIVILEGED if privileged else MAX_PENDING_UPLOADS
    quota_key = f"{_QUOTA_KEY_PREFIX}{user_id}"
    try:
        cutoff = time.time() - (25 * 3600)
        await redis.zremrangebyscore(quota_key, "-inf", cutoff)

        if reserve_key:
            async with redis.pipeline() as pipe:
                pipe.zadd(quota_key, {reserve_key: time.time()})
                pipe.zcard(quota_key)
                results = await pipe.execute()

            count = int(results[1])
            if count > cap:
                await redis.zrem(quota_key, reserve_key)
                raise BadRequestError(
                    f"Too many pending uploads ({cap} max). "
                    "Submit a pull request or wait for existing uploads to expire.",
                    code=ERR_QUOTA_EXCEEDED,
                )
        else:
            count = await redis.zcard(quota_key)
            if count >= cap:
                raise BadRequestError(
                    f"Too many pending uploads ({cap} max). "
                    "Submit a pull request or wait for existing uploads to expire.",
                    code=ERR_QUOTA_EXCEEDED,
                )
    except BadRequestError:
        raise
    except Exception as exc:
        logger.warning(
            "Redis quota check failed for %s -- falling back to DB count: %s",
            user_id,
            exc,
        )
        # Fallback: count pending rows in DB (degraded mode — no atomic reservation)
        try:
            from sqlalchemy import func, select

            from app.models.upload import Upload

            async with async_session_factory() as _db:
                db_count = await _db.scalar(
                    select(func.count())
                    .select_from(Upload)
                    .where(Upload.user_id == UUID(user_id), Upload.status == "pending")
                ) or 0
            if db_count >= cap:
                raise BadRequestError(
                    f"Too many pending uploads ({cap} max). "
                    "Submit a pull request or wait for existing uploads to expire.",
                    code=ERR_QUOTA_EXCEEDED,
                )
        except BadRequestError:
            raise
        except Exception as db_exc:
            logger.error(
                "DB quota fallback also failed for %s -- rejecting upload: %s",
                user_id,
                db_exc,
            )
            raise BadRequestError(
                "Service temporarily unavailable (quota check failed). Please try again later."
            )


async def _enqueue_processing(
    user_id: str,
    upload_id: str,
    quarantine_key: str,
    filename: str,
    mime_type: str,
    *,
    file_size: int = 0,
    trace_context: dict[str, str] | None = None,
    expected_sha256: str | None = None,
) -> None:
    """Enqueue the background processing ARQ job.

    Routes to the fast queue for files below ``_FAST_QUEUE_THRESHOLD`` so that
    small document uploads are never blocked by large video transcode jobs.
    """
    from app.core.telemetry import inject_trace_context

    if redis_core.arq_pool is None:
        raise BadRequestError("Background processing is temporarily unavailable. Please try again.")

    # Priority-based queue routing
    is_fast_mime = any(mime_type.startswith(m) for m in ("text/", "image/"))
    is_heavy_mime = any(mime_type.startswith(m) for m in ("video/", "application/pdf", "application/zip", "application/x-zip-compressed", "application/epub+zip", "application/vnd.openxmlformats-officedocument"))

    if is_fast_mime and not is_heavy_mime:
        queue_name = _FAST_QUEUE_NAME
    elif is_heavy_mime:
        queue_name = _SLOW_QUEUE_NAME
    else:
        # Fallback to size-based routing for unknown/mixed types
        queue_name = _FAST_QUEUE_NAME if file_size < _FAST_QUEUE_THRESHOLD else _SLOW_QUEUE_NAME

    tc = trace_context if trace_context is not None else inject_trace_context()
    await redis_core.arq_pool.enqueue_job(
        "process_upload",
        _queue_name=queue_name,
        user_id=user_id,
        upload_id=upload_id,
        quarantine_key=quarantine_key,
        original_filename=filename,
        mime_type=mime_type,
        expected_sha256=expected_sha256,
        trace_context=tc,
    )

"""Tests for Phase 4 UX improvements.

Covers:
- 4A: POST /api/upload/status/batch, GET /api/upload/mine
- 4B: GET /api/upload/config fields (recommended_path, direct_threshold_mb)
- 4C: SSE rate limiting (max 10 concurrent per user), keepalive set to 15s
- 4D: Server-side CAS pre-check in direct upload
"""

import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.upload import Upload
from app.models.user import User, UserRole


def _auth_headers(user: User) -> dict[str, str]:
    from app.core.security import create_access_token

    token, _ = create_access_token(str(user.id), user.role.value, user.email)
    return {"Authorization": f"Bearer {token}"}


async def _create_user(db: AsyncSession, role: UserRole = UserRole.STUDENT) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex[:8]}@telecom-sudparis.eu",
        display_name="Tester",
        role=role,
        onboarded=True,
        gdpr_consent=True,
    )
    db.add(user)
    await db.flush()
    return user


# ── 4B: Upload config endpoint ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upload_config_has_recommended_path(client: AsyncClient):
    """GET /api/upload/config must return recommended_path and direct_threshold_mb."""
    response = await client.get("/api/upload/config")
    assert response.status_code == 200
    data = response.json()
    assert "recommended_path" in data
    assert data["recommended_path"] in ("direct", "tus")
    assert "direct_threshold_mb" in data
    assert isinstance(data["direct_threshold_mb"], int)
    assert data["direct_threshold_mb"] > 0


# ── 4A: Batch status endpoint ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_batch_status_returns_known_keys(
    client: AsyncClient, db_session: AsyncSession, mock_redis: AsyncMock
):
    """POST /api/upload/status/batch returns statuses for owned file keys."""
    user = await _create_user(db_session)
    await db_session.commit()

    user_id = str(user.id)
    key1 = f"quarantine/{user_id}/upload1/file.pdf"
    key2 = f"quarantine/{user_id}/upload2/file.pdf"
    foreign_key = "quarantine/other-user/upload3/file.pdf"

    status_payload = json.dumps({"file_key": key1, "status": "processing"})

    # Mock mget to return the status for key1 and None for key2
    mock_redis.mget.return_value = [status_payload.encode(), None]

    response = await client.post(
        "/api/upload/status/batch",
        json={"file_keys": [key1, key2, foreign_key]},
        headers=_auth_headers(user),
    )
    assert response.status_code == 200
    data = response.json()
    assert "statuses" in data
    # foreign_key silently omitted
    assert foreign_key not in data["statuses"]
    # owned keys present
    assert key1 in data["statuses"]
    assert key2 in data["statuses"]
    # key1 has the cached status
    assert data["statuses"][key1]["status"] == "processing"
    # key2 has no cached status → PENDING
    assert data["statuses"][key2]["status"] == "pending"


@pytest.mark.asyncio
async def test_batch_status_requires_auth(client: AsyncClient):
    """POST /api/upload/status/batch requires authentication."""
    response = await client.post(
        "/api/upload/status/batch",
        json={"file_keys": ["quarantine/x/y/z"]},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_batch_status_max_50_keys(
    client: AsyncClient, db_session: AsyncSession, mock_redis: AsyncMock
):
    """POST /api/upload/status/batch rejects more than 50 keys."""
    user = await _create_user(db_session)
    await db_session.commit()

    keys = [f"quarantine/{user.id}/upload{i}/f.pdf" for i in range(51)]
    response = await client.post(
        "/api/upload/status/batch",
        json={"file_keys": keys},
        headers=_auth_headers(user),
    )
    assert response.status_code == 422  # Pydantic validation error (max_length=50)


# ── 4A: Upload history endpoint ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upload_mine_returns_history(client: AsyncClient, db_session: AsyncSession):
    """GET /api/upload/mine returns the user's upload history."""
    user = await _create_user(db_session)

    upload = Upload(
        upload_id=str(uuid.uuid4()),
        user_id=user.id,
        quarantine_key=f"quarantine/{user.id}/abc/doc.pdf",
        filename="doc.pdf",
        mime_type="application/pdf",
        size_bytes=1024,
        status="clean",
    )
    db_session.add(upload)
    await db_session.commit()

    response = await client.get("/api/upload/mine", headers=_auth_headers(user))
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["filename"] == "doc.pdf"
    assert data["items"][0]["status"] == "clean"


@pytest.mark.asyncio
async def test_upload_mine_empty_for_new_user(client: AsyncClient, db_session: AsyncSession):
    """GET /api/upload/mine returns empty list for a user with no uploads."""
    user = await _create_user(db_session)
    await db_session.commit()

    response = await client.get("/api/upload/mine", headers=_auth_headers(user))
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 0
    assert data["items"] == []


# ── 4C: SSE rate limiting ─────────────────────────────────────────────────────


def test_sse_keepalive_is_15s():
    """SSE keepalive interval must be 15 seconds (issue 4.10)."""
    from app.routers.upload.sse import _SSE_KEEPALIVE

    assert _SSE_KEEPALIVE == 15.0


def test_sse_max_per_user_is_10():
    """SSE max concurrent streams per user must be 10 (issue 1.14)."""
    from app.routers.upload.sse import _SSE_MAX_PER_USER

    assert _SSE_MAX_PER_USER == 10


@pytest.mark.asyncio
async def test_sse_rate_limit_blocks_at_11th_connection(
    client: AsyncClient, db_session: AsyncSession, mock_redis: AsyncMock
):
    """The 11th concurrent SSE stream from the same user gets a 429."""
    user = await _create_user(db_session)
    await db_session.commit()

    user_id = str(user.id)
    file_key = f"quarantine/{user_id}/upload1/file.pdf"

    # Simulate that 10 streams are already active
    mock_redis.incr.return_value = 11

    response = await client.get(
        f"/api/upload/events/{file_key}",
        headers=_auth_headers(user),
    )
    assert response.status_code == 429


# ── 4D: Server-side CAS pre-check ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_direct_upload_cas_hit_returns_clean(
    client: AsyncClient, db_session: AsyncSession, mock_redis: AsyncMock
):
    """Direct upload with a CAS hit returns CLEAN immediately without quarantine upload."""
    user = await _create_user(db_session)
    await db_session.commit()

    import time as _time

    sha256 = "a" * 64
    from app.core.cas import hmac_cas_key

    cas_key = hmac_cas_key(sha256)
    cas_data = json.dumps({
        "final_key": "cas/abc123",
        "mime_type": "application/pdf",
        "size": 1024,
        "scanned_at": _time.time(),  # fresh CAS entry so staleness check passes
    }).encode()

    def _redis_get(key):
        if key == cas_key:
            return cas_data
        return None

    mock_redis.get.side_effect = _redis_get

    # Mock the scanner that now re-scans on CAS hits (audit review fix)
    mock_scanner = AsyncMock()
    mock_scanner.scan_file_path = AsyncMock()

    with (
        patch("app.routers.upload.direct.ProcessingFile.sha256", new_callable=AsyncMock, return_value=sha256),
        patch("app.core.storage.object_exists", new_callable=AsyncMock, return_value=True),
        patch("app.core.storage.copy_object", new_callable=AsyncMock),
        patch("app.routers.upload.direct._create_upload_row", new_callable=AsyncMock),
        patch("app.routers.upload.direct._check_pending_cap", new_callable=AsyncMock),
    ):
        # Inject scanner mock into app state
        from app.main import app as _app
        original_scanner = getattr(_app.state, "scanner", None)
        _app.state.scanner = mock_scanner

        import io

        response = await client.post(
            "/api/upload",
            files={"file": ("test.pdf", io.BytesIO(b"%PDF-1.7\x00" * 100), "application/pdf")},
            headers=_auth_headers(user),
        )

        _app.state.scanner = original_scanner

    assert response.status_code == 202
    data = response.json()
    assert data["status"] == "clean"

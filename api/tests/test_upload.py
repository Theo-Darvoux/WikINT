import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError
from app.models.user import User, UserRole


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


def _auth_headers(user: User) -> dict[str, str]:
    from app.core.security import create_access_token

    token, _ = create_access_token(str(user.id), user.role.value, user.email)
    return {"Authorization": f"Bearer {token}"}


@patch("app.routers.upload.generate_presigned_put", new_callable=AsyncMock)
@patch("app.routers.upload.get_s3_client")
async def test_request_upload_url(
    mock_s3_cm, mock_generate, client: AsyncClient, db_session: AsyncSession
) -> None:
    mock_generate.return_value = "https://presigned.url/put"

    # Mock s3 client and paginator to avoid real network calls
    mock_s3 = AsyncMock()
    # Correctly mock the async context manager
    mock_s3_cm.return_value.__aenter__.return_value = mock_s3

    mock_paginator = MagicMock()
    mock_s3.get_paginator = MagicMock(return_value=mock_paginator)

    # paginate returns an AsyncIterator
    class MockAsyncIterator:
        def __init__(self, items):
            self.items = items

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self.items:
                raise StopAsyncIteration
            return self.items.pop(0)

    mock_paginator.paginate.return_value = MockAsyncIterator([])

    user = await _create_user(db_session)
    await db_session.commit()

    payload = {"filename": "test.pdf", "size": 1024, "mime_type": "application/pdf"}

    response = await client.post(
        "/api/upload/request-url", json=payload, headers=_auth_headers(user)
    )
    assert response.status_code == 200
    data = response.json()
    assert "upload_url" in data
    assert "file_key" in data
    assert data["mime_type"] == "application/pdf"


async def test_request_upload_url_too_large(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await db_session.commit()

    payload = {
        "filename": "huge.iso",
        "size": 2 * 1024 * 1024 * 1024,  # 2 GB
        "mime_type": "application/x-iso9660-image",
    }

    response = await client.post(
        "/api/upload/request-url", json=payload, headers=_auth_headers(user)
    )
    assert response.status_code == 400
    assert "exceeds maximum" in response.json()["detail"]


@patch("app.routers.upload.get_object_info", new_callable=AsyncMock)
@patch("app.routers.upload._scan_instream", new_callable=AsyncMock)
@patch("app.routers.upload.read_object_bytes", new_callable=AsyncMock)
@patch("app.routers.upload.read_full_object", new_callable=AsyncMock)
@patch("app.routers.upload.get_redis", new_callable=AsyncMock)
async def test_complete_upload_success(
    mock_get_redis,
    mock_read_full,
    mock_read_bytes,
    mock_scan,
    mock_info,
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    mock_info.return_value = {"size": 1024, "content_type": "application/pdf"}
    mock_scan.return_value = True
    mock_read_bytes.return_value = b"%PDF-1.4"
    mock_read_full.return_value = b"%PDF-1.4 content"

    # Mock redis
    mock_redis = AsyncMock()
    mock_redis.get.return_value = None
    m_gen = MagicMock()
    m_gen.__anext__.return_value = mock_redis
    mock_get_redis.return_value = m_gen

    user = await _create_user(db_session)
    await db_session.commit()

    payload = {"file_key": f"uploads/{user.id}/{uuid.uuid4()}/file.pdf"}

    response = await client.post("/api/upload/complete", json=payload, headers=_auth_headers(user))
    assert response.status_code == 200
    data = response.json()
    assert data["size"] == 1024
    assert data["mime_type"] == "application/pdf"


@patch("app.routers.upload.get_object_info", new_callable=AsyncMock)
@patch("app.routers.upload.get_redis", new_callable=AsyncMock)
async def test_complete_upload_not_found(
    mock_get_redis, mock_info, client: AsyncClient, db_session: AsyncSession
) -> None:
    mock_info.side_effect = Exception("Not found")

    # Mock redis
    mock_redis = AsyncMock()
    mock_redis.get.return_value = None
    m_gen = MagicMock()
    m_gen.__anext__.return_value = mock_redis
    mock_get_redis.return_value = m_gen

    user = await _create_user(db_session)
    await db_session.commit()

    payload = {"file_key": f"uploads/{user.id}/{uuid.uuid4()}/fake.pdf"}

    response = await client.post("/api/upload/complete", json=payload, headers=_auth_headers(user))
    assert response.status_code == 400
    assert "not found in storage" in response.json()["detail"]


@patch("app.routers.upload.get_object_info", new_callable=AsyncMock)
@patch("app.routers.upload._scan_instream", new_callable=AsyncMock)
@patch("app.routers.upload.delete_object", new_callable=AsyncMock)
@patch("app.routers.upload.read_object_bytes", new_callable=AsyncMock)
@patch("app.routers.upload.read_full_object", new_callable=AsyncMock)
@patch("app.routers.upload.get_redis", new_callable=AsyncMock)
async def test_complete_upload_virus_detected(
    mock_get_redis,
    mock_read_full,
    mock_read_bytes,
    mock_delete,
    mock_scan,
    mock_info,
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    mock_info.return_value = {"size": 1024, "content_type": "application/pdf"}
    mock_scan.side_effect = BadRequestError("File failed virus scan")
    mock_read_bytes.return_value = b"%PDF-1.4"
    mock_read_full.return_value = b"%PDF-1.4 content"

    # Mock redis
    mock_redis = AsyncMock()
    mock_redis.get.return_value = None
    m_gen = MagicMock()
    m_gen.__anext__.return_value = mock_redis
    mock_get_redis.return_value = m_gen

    user = await _create_user(db_session)
    await db_session.commit()

    payload = {"file_key": f"uploads/{user.id}/{uuid.uuid4()}/virus.pdf"}

    response = await client.post("/api/upload/complete", json=payload, headers=_auth_headers(user))
    assert response.status_code == 400
    assert "failed virus scan" in response.json()["detail"]
    mock_delete.assert_called_once_with(payload["file_key"])

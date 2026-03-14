import uuid
from unittest.mock import AsyncMock, patch

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

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
async def test_request_upload_url(mock_generate, client: AsyncClient, db_session: AsyncSession) -> None:
    mock_generate.return_value = "https://presigned.url/put"
    user = await _create_user(db_session)
    await db_session.commit()

    payload = {
        "filename": "test.pdf",
        "size": 1024,
        "mime_type": "application/pdf"
    }

    response = await client.post("/api/upload/request-url", json=payload, headers=_auth_headers(user))
    assert response.status_code == 200
    data = response.json()
    assert data["upload_url"] == "https://presigned.url/put"
    assert "uploads/" in data["file_key"]
    assert "test.pdf" in data["file_key"]


async def test_request_upload_url_too_large(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await db_session.commit()

    payload = {
        "filename": "huge.iso",
        "size": 2 * 1024 * 1024 * 1024,  # 2 GB
        "mime_type": "application/x-iso9660-image"
    }

    response = await client.post("/api/upload/request-url", json=payload, headers=_auth_headers(user))
    assert response.status_code == 400
    assert "exceeds maximum" in response.json()["detail"]


@patch("app.routers.upload.object_exists", new_callable=AsyncMock)
@patch("app.routers.upload.get_object_info", new_callable=AsyncMock)
@patch("app.routers.upload._scan_file", new_callable=AsyncMock)
async def test_complete_upload_success(
    mock_scan, mock_info, mock_exists, client: AsyncClient, db_session: AsyncSession
) -> None:
    mock_exists.return_value = True
    mock_info.return_value = {"size": 1024, "content_type": "application/pdf"}
    mock_scan.return_value = True

    user = await _create_user(db_session)
    await db_session.commit()

    payload = {
        "file_key": f"uploads/{user.id}/file.pdf"
    }

    response = await client.post("/api/upload/complete", json=payload, headers=_auth_headers(user))
    assert response.status_code == 200
    data = response.json()
    assert data["file_key"] == payload["file_key"]
    assert data["size"] == 1024
    assert data["mime_type"] == "application/pdf"


@patch("app.routers.upload.object_exists", new_callable=AsyncMock)
async def test_complete_upload_not_found(mock_exists, client: AsyncClient, db_session: AsyncSession) -> None:
    mock_exists.return_value = False

    user = await _create_user(db_session)
    await db_session.commit()

    payload = {
        "file_key": "uploads/fake/file.pdf"
    }

    response = await client.post("/api/upload/complete", json=payload, headers=_auth_headers(user))
    assert response.status_code == 400
    assert "not found in storage" in response.json()["detail"]


@patch("app.routers.upload.object_exists", new_callable=AsyncMock)
@patch("app.routers.upload.get_object_info", new_callable=AsyncMock)
@patch("app.routers.upload._scan_file", new_callable=AsyncMock)
@patch("app.routers.upload.delete_object", new_callable=AsyncMock)
async def test_complete_upload_virus_detected(
    mock_delete, mock_scan, mock_info, mock_exists, client: AsyncClient, db_session: AsyncSession
) -> None:
    mock_exists.return_value = True
    mock_info.return_value = {"size": 1024, "content_type": "application/pdf"}
    mock_scan.return_value = False

    user = await _create_user(db_session)
    await db_session.commit()

    payload = {
        "file_key": f"uploads/{user.id}/virus.pdf"
    }

    response = await client.post("/api/upload/complete", json=payload, headers=_auth_headers(user))
    assert response.status_code == 400
    assert "failed virus scan" in response.json()["detail"]
    mock_delete.assert_called_once_with(payload["file_key"])

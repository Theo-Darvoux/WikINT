import io
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, ServiceUnavailableError
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


def _make_pdf_file(content: bytes = b"%PDF-1.4 test content") -> dict:
    """Create a multipart file tuple for httpx."""
    return {"file": ("test.pdf", io.BytesIO(content), "application/pdf")}


@patch("app.routers.upload.scan_file", new_callable=AsyncMock)
@patch("app.routers.upload.get_s3_client")
async def test_upload_success(
    mock_s3_cm,
    mock_scan,
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    mock_scan.return_value = None

    mock_s3 = AsyncMock()
    mock_s3_cm.return_value.__aenter__.return_value = mock_s3
    mock_paginator = MagicMock()
    mock_s3.get_paginator = MagicMock(return_value=mock_paginator)

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

    response = await client.post(
        "/api/upload",
        files=_make_pdf_file(),
        headers=_auth_headers(user),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["mime_type"] == "application/pdf"
    assert data["size"] > 0
    assert "file_key" in data
    assert data["file_key"].startswith(f"uploads/{user.id}/")

    mock_scan.assert_called_once()
    mock_s3.put_object.assert_called_once()


async def test_upload_extension_not_allowed(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await db_session.commit()

    response = await client.post(
        "/api/upload",
        files={"file": ("malware.exe", io.BytesIO(b"MZ..."), "application/x-executable")},
        headers=_auth_headers(user),
    )
    assert response.status_code == 400
    assert "not supported" in response.json()["detail"]


async def test_upload_too_large(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await db_session.commit()

    # Create a file just over 100 MiB (the default max)
    # We don't actually send 100MB — the test just verifies the limit logic
    # by patching max_file_size_mb to a small value
    with patch("app.routers.upload.settings") as mock_settings:
        mock_settings.max_file_size_mb = 0  # 0 MiB limit
        mock_settings.s3_bucket = "test"

        response = await client.post(
            "/api/upload",
            files=_make_pdf_file(b"%PDF-1.4 some content here"),
            headers=_auth_headers(user),
        )
        assert response.status_code == 400
        assert "exceeds maximum" in response.json()["detail"]


@patch("app.routers.upload.scan_file", new_callable=AsyncMock)
async def test_upload_malware_detected(
    mock_scan,
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    mock_scan.side_effect = BadRequestError("File failed malware scan")

    user = await _create_user(db_session)
    await db_session.commit()

    response = await client.post(
        "/api/upload",
        files=_make_pdf_file(),
        headers=_auth_headers(user),
    )
    assert response.status_code == 400
    assert "malware scan" in response.json()["detail"]


@patch("app.routers.upload.scan_file", new_callable=AsyncMock)
async def test_upload_scanner_unavailable(
    mock_scan,
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    mock_scan.side_effect = ServiceUnavailableError(
        "Malware scanner unavailable — file rejected (fail-closed)"
    )

    user = await _create_user(db_session)
    await db_session.commit()

    response = await client.post(
        "/api/upload",
        files=_make_pdf_file(),
        headers=_auth_headers(user),
    )
    assert response.status_code == 503
    assert "fail-closed" in response.json()["detail"]


@patch("app.routers.upload.scan_file", new_callable=AsyncMock)
async def test_upload_svg_xss_rejected(
    mock_scan,
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    svg_with_script = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

    user = await _create_user(db_session)
    response = await client.post(
        "/api/upload",
        files={"file": ("image.svg", io.BytesIO(svg_with_script), "image/svg+xml")},
        headers=_auth_headers(user),
    )
    # SVG safety check runs before scanner, so scanner should not be called
    assert response.status_code == 400
    assert (
        "scripts" in response.json()["detail"].lower()
        or "active content" in response.json()["detail"].lower()
    )
    mock_scan.assert_not_called()


async def test_deprecated_request_url(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await db_session.commit()

    response = await client.post(
        "/api/upload/request-url",
        json={"filename": "test.pdf", "size": 1024, "mime_type": "application/pdf"},
        headers=_auth_headers(user),
    )
    assert response.status_code == 400
    assert "removed" in response.json()["detail"]


async def test_deprecated_complete(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    await db_session.commit()

    response = await client.post(
        "/api/upload/complete",
        json={"file_key": "uploads/fake/fake/test.pdf"},
        headers=_auth_headers(user),
    )
    assert response.status_code == 400
    assert "removed" in response.json()["detail"]

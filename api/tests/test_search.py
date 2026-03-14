import uuid
from unittest.mock import AsyncMock, patch

import pytest
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

@pytest.fixture
def mock_meili_client():
    with patch("app.services.search.meili_client") as mock:
        yield mock

@pytest.mark.asyncio
async def test_global_search_success(client: AsyncClient, db_session: AsyncSession, mock_meili_client: AsyncMock):
    user = await _create_user(db_session)
    await db_session.commit()

    # Setup the mock to return a multi_search response
    class MockHits:
        def __init__(self, hits, est_total):
            self.hits = hits
            self.estimated_total_hits = est_total

    class MockMultiSearchResponse:
        def __init__(self):
            self.results = [
                MockHits([{"id": "mat1", "title": "Test Material"}], 1),
                MockHits([{"id": "dir1", "name": "Test Directory"}], 1)
            ]

    mock_meili_client.multi_search = AsyncMock(return_value=MockMultiSearchResponse())

    response = await client.get("/api/search?q=test&page=1&limit=10", headers=_auth_headers(user))

    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data
    assert data["total"] == 2
    assert len(data["items"]) == 2

    # We expect directories first, then materials based on perform_search logic
    assert data["items"][0]["search_type"] == "directory"
    assert data["items"][0]["name"] == "Test Directory"
    assert data["items"][1]["search_type"] == "material"
    assert data["items"][1]["title"] == "Test Material"

@pytest.mark.asyncio
async def test_global_search_pagination(client: AsyncClient, db_session: AsyncSession, mock_meili_client: AsyncMock):
    user = await _create_user(db_session)
    await db_session.commit()

    class MockHits:
        def __init__(self, hits, est_total):
            self.hits = hits
            self.estimated_total_hits = est_total

    class MockMultiSearchResponse:
        def __init__(self):
            self.results = [
                MockHits([{"id": "mat1", "title": "Mat"}], 10),
                MockHits([], 0)
            ]

    mock_meili_client.multi_search = AsyncMock(return_value=MockMultiSearchResponse())

    response = await client.get("/api/search?q=test&page=2&limit=5", headers=_auth_headers(user))

    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 2
    assert data["limit"] == 5
    assert data["total"] == 10

    # Verify the offset passed to Meilisearch
    mock_meili_client.multi_search.assert_called_once()
    call_args = mock_meili_client.multi_search.call_args[0][0]
    assert call_args[0]["offset"] == 5
    assert call_args[1]["offset"] == 5

@pytest.mark.asyncio
async def test_global_search_validation(client: AsyncClient, db_session: AsyncSession, mock_meili_client: AsyncMock):
    user = await _create_user(db_session)
    await db_session.commit()
    headers = _auth_headers(user)

    # Empty query should fail
    response = await client.get("/api/search?q=", headers=headers)
    assert response.status_code == 422

    # Invalid page should fail
    response = await client.get("/api/search?q=test&page=0", headers=headers)
    assert response.status_code == 422

    # Limit too high should fail
    response = await client.get("/api/search?q=test&limit=100", headers=headers)
    assert response.status_code == 422

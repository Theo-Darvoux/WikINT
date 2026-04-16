from unittest.mock import AsyncMock

from httpx import AsyncClient


async def test_health(client: AsyncClient) -> None:
    response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ("ok", "degraded")
    assert "details" in data


async def test_request_code_invalid_domain(client: AsyncClient) -> None:
    response = await client.post(
        "/api/auth/request-code",
        json={"email": "test@gmail.com"},
    )
    assert response.status_code == 422


async def test_request_code_plus_alias(client: AsyncClient) -> None:
    response = await client.post(
        "/api/auth/request-code",
        json={"email": "test+alias@telecom-sudparis.eu"},
    )
    assert response.status_code == 422


async def test_verify_code_invalid(client: AsyncClient, mock_redis: AsyncMock) -> None:
    from app.config import settings

    original_env = settings.environment
    settings.environment = "production"

    # Mock redis to return no previous attempts
    mock_redis.get = AsyncMock(return_value=None)

    try:
        response = await client.post(
            "/api/auth/verify-code",
            json={"email": "test@telecom-sudparis.eu", "code": "WRONGCOD"},
        )
        assert response.status_code == 400
        # Check that increment was called
        mock_redis.pipeline.assert_called()
    finally:
        settings.environment = original_env


async def test_verify_code_rate_limit(client: AsyncClient, mock_redis: AsyncMock) -> None:
    from app.config import settings
    from app.services import auth as auth_service

    email = "test@telecom-sudparis.eu"

    # Force production environment for rate limit check
    original_env = settings.environment
    settings.environment = "production"

    try:
        # Mock redis to return max rate limit
        mock_redis.get = AsyncMock(return_value=str(auth_service.VERIFY_RATE_LIMIT_MAX))

        response = await client.post(
            "/api/auth/verify-code",
            json={"email": email, "code": "A2B3C4D5"},
        )
        assert response.status_code == 429
        assert "Too many verification attempts" in response.json()["detail"]
    finally:
        settings.environment = original_env

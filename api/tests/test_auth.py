from httpx import AsyncClient


async def test_health(client: AsyncClient) -> None:
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


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


async def test_verify_code_invalid(client: AsyncClient) -> None:
    response = await client.post(
        "/api/auth/verify-code",
        json={"email": "test@telecom-sudparis.eu", "code": "000000"},
    )
    assert response.status_code == 400

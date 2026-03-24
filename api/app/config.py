from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_file": ".env", "extra": "ignore"}

    environment: str = "development"
    secret_key: str = "change-this-to-a-secure-random-string-with-at-least-32-bytes"

    database_url: str = "postgresql+asyncpg://wikint:wikint@localhost:5432/wikint"

    redis_url: str = "redis://localhost:6379/0"

    s3_endpoint: str = "localhost:9000"
    s3_public_endpoint: str | None = None
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "wikint"
    s3_region: str = "us-east-1"
    s3_use_ssl: bool = False

    meili_url: str = "http://localhost:7700"
    meili_master_key: str = "change-me"

    max_file_size_mb: int = 100

    clamav_host: str = "localhost"
    clamav_port: int = 3310
    clamav_scan_timeout_base: int = 60
    clamav_scan_timeout_per_gb: int = 120

    smtp_host: str = "smtp.example.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_tls: bool = True

    jwt_access_token_expire_days: int = 7
    jwt_refresh_token_expire_days: int = 31

    frontend_url: str = "http://localhost:3000"

    # Stored as a comma-separated string so pydantic-settings never attempts JSON
    # parsing on it. Use the `cors_headers_list` property in application code.
    cors_allowed_headers: str = "Content-Type,Authorization,X-Client-ID,Accept,X-Requested-With"

    @property
    def cors_headers_list(self) -> list[str]:
        """Return CORS headers as a list, handling empty / blank values gracefully."""
        return [h.strip() for h in self.cors_allowed_headers.split(",") if h.strip()] or [
            "Content-Type",
            "Authorization",
            "X-Client-ID",
            "Accept",
            "X-Requested-With",
        ]

    # ONLYOFFICE Document Server
    onlyoffice_internal_api_base_url: str = "http://api:8000"
    onlyoffice_jwt_secret: str = "change-me-onlyoffice-jwt-secret"
    # Separate secret for file-access tokens — known only to the API.
    # Must differ from onlyoffice_jwt_secret so a compromised OnlyOffice
    # container cannot forge file-download tokens.
    onlyoffice_file_token_secret: str = "change-me-onlyoffice-file-token-secret"
    onlyoffice_file_token_ttl: int = 60  # seconds (1 minute)

    @model_validator(mode="after")
    def _check_onlyoffice_secrets(self) -> "Settings":
        _known_placeholders = {
            "change-me-onlyoffice-jwt-secret",
            # Value shipped in .env.example and used as the docker-compose dev fallback.
            # Both are publicly known and must never reach production.
            "insecure-dev-only-onlyoffice-secret",
        }
        if self.onlyoffice_jwt_secret in _known_placeholders:
            raise ValueError(
                "ONLYOFFICE_JWT_SECRET must be set to a secret value. "
                'Generate one: python -c "import secrets; print(secrets.token_hex(32))"'
            )

        _file_token_placeholders = {
            "change-me-onlyoffice-file-token-secret",
            "insecure-dev-only-onlyoffice-file-token-secret",
        }
        if self.onlyoffice_file_token_secret in _file_token_placeholders:
            raise ValueError(
                "ONLYOFFICE_FILE_TOKEN_SECRET must be set to a secret value. "
                'Generate one: python -c "import secrets; print(secrets.token_hex(32))"'
            )

        if self.onlyoffice_file_token_secret == self.onlyoffice_jwt_secret:
            raise ValueError(
                "ONLYOFFICE_FILE_TOKEN_SECRET must differ from ONLYOFFICE_JWT_SECRET. "
                "The file token secret is known only to the API, while the JWT secret "
                "is shared with the OnlyOffice container."
            )
        return self

    @property
    def is_dev(self) -> bool:
        return self.environment == "development"


settings = Settings()

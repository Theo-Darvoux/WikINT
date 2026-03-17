from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_file": ".env", "extra": "ignore"}

    environment: str = "development"
    secret_key: str = "change-this-to-a-secure-random-string-with-at-least-32-bytes"

    database_url: str = "postgresql+asyncpg://wikint:wikint@localhost:5432/wikint"

    redis_url: str = "redis://localhost:6379/0"

    minio_endpoint: str = "localhost:9000"
    minio_public_endpoint: str | None = None
    minio_root_user: str = "minioadmin"
    minio_root_password: str = "minioadmin"
    minio_bucket: str = "wikint"
    minio_use_ssl: bool = False

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

    @property
    def is_dev(self) -> bool:
        return self.environment == "development"


settings = Settings()

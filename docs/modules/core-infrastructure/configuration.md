# Configuration Module (`api/app/config.py`)

## Purpose

Centralizes all application configuration via Pydantic Settings. Environment variables are loaded from `.env` files and can be overridden by actual environment variables (standard 12-factor app pattern).

## Settings Class

`Settings` extends `BaseSettings` with `env_file=".env"` and `extra="ignore"` (unknown env vars are silently ignored rather than causing validation errors).

## Configuration Groups

### Core
| Setting | Default | Purpose |
|---------|---------|---------|
| `environment` | `development` | Literal `["development", "production", "test"]`. Controls dev-only features. |
| `secret_key` | `SecretStr` | JWT signing key, HMAC derivation base (masked in logs). |
| `pdf_quality` | `75` | Integer (0-100). PDF compression quality logic threshold. |
| `pdf_compression_level` | `None` | Optional Ghostscript-style alias (e.g., `/screen`, `/ebook`) that maps to `pdf_quality`. |
| `video_compression_profile` | `heavy` | Literal `["none", "light", "medium", "aggressive", "heavy", "extreme"]`. FFmpeg compression profile. |

### Database
| Setting | Default | Purpose |
|---------|---------|---------|
| `database_url` | postgresql+asyncpg://... | Async SQLAlchemy DSN |

### Redis
| Setting | Default | Purpose |
|---------|---------|---------|
| `redis_url` | redis://localhost:6379/0 | Shared by rate limiter, cache, ARQ |

### S3 / Object Storage
| Setting | Default | Purpose |
|---------|---------|---------|
| `s3_endpoint` | localhost:9000 | MinIO/R2 endpoint |
| `s3_public_endpoint` | None | If set, presigned GET URLs are rewritten to this host |
| `s3_access_key` / `s3_secret_key` | minioadmin | Credentials |
| `s3_bucket` | wikint | Single bucket |
| `s3_region` | us-east-1 | Required for SigV4 |
| `s3_use_ssl` | false | HTTPS for S3 connections |
| `s3_use_accelerate_endpoint` | false | S3 Transfer Acceleration |

### File Size Limits
The system enforces size limits at two levels:

| Setting | Default | Purpose |
|---------|---------|---------|
| `max_file_size_mb` | 100 | Global maximum |
| `max_svg_size_mb` | 5 | SVG (attack vector, processed in-memory) |
| `max_image_size_mb` | 50 | Images |
| `max_audio_size_mb` | 200 | Audio files |
| `max_video_size_mb` | 500 | Video files |
| `max_document_size_mb` | 200 | PDFs, EPUBs |
| `max_office_size_mb` | 100 | Office documents |
| `max_text_size_mb` | 10 | Text/code files |

The per-category limits override the global limit. A 150 MiB video is allowed (under the 500 MiB video limit) even though it exceeds the 100 MiB global default, because the category-specific limit takes precedence.

### Worker Concurrency
| Setting | Default | Purpose |
|---------|---------|---------|
| `global_max_subprocesses` | 0 (auto: `os.cpu_count()`) | Max concurrent sandboxed subprocesses (ffmpeg, Ghostscript, exiftool) |
| `max_concurrent_image_ops` | 0 (auto: `cpu_count // 2`) | Max concurrent Pillow image operations |

### Upload Pipeline & CAS
| Setting | Default | Purpose |
|---------|---------|---------|
| `upload_pipeline_max_seconds` | 600 | Hard deadline for the entire worker pipeline |
| `cas_max_age_seconds` | 604800 | 7-day TTL for CAS entries before re-scanning is mandatory |
| `enable_presigned_multipart` | true | Enable AWS S3 multipart upload for large files |
| `direct_upload_threshold_mb` | 10 | Files below this size use `POST /api/upload` (direct) |

### Webhooks
| Setting | Default | Purpose |
|---------|---------|---------|
| `webhook_secret` | "" | HMAC-SHA256 secret for signing upload-complete webhooks |

### TUS Resumable Upload
| Setting | Default | Purpose |
|---------|---------|---------|
| `tus_chunk_min_bytes` | 5 MiB | S3 multipart minimum |
| `tus_chunk_max_bytes` | 100 MiB | Upper bound per chunk |
| `tus_max_size_bytes` | 500 MiB | Maximum total file size |
| `tus_max_concurrent_per_user` | 8 | Concurrent TUS uploads |

### Malware Scanning
| Setting | Default | Purpose |
|---------|---------|---------|
| `yara_rules_dir` | "yara_rules" | Directory of .yar/.yara rule files |
| `yara_scan_timeout` | 60 | Seconds before YARA scan times out |
| `malwarebazaar_timeout` | 5 | HTTP request timeout for MalwareBazaar API |
| `malwarebazaar_url` | abuse.ch API | MalwareBazaar endpoint |
| `malwarebazaar_api_key` | None | Optional API key for higher rate limits |
| `malwarebazaar_fail_closed` | true | When true, API failure = scan failure (fail-closed default) |

### SMTP / Email
| Setting | Default | Purpose |
|---------|---------|---------|
| `smtp_host/port/user/password/from` | | SMTP credentials for OTP emails |
| `smtp_ip` | None | Optional IP address to connect to, bypassing DNS (verifies certificate against `smtp_host`) |
| `smtp_use_tls` | true | STARTTLS |

### Observability
| Setting | Default | Purpose |
|---------|---------|---------|
| `metrics_token` | "" | Bearer token for `/metrics` scraping |
| `otel_endpoint` | "" | OpenTelemetry Collector gRPC endpoint |

### OnlyOffice
| Setting | Default | Purpose |
|---------|---------|---------|
| `onlyoffice_jwt_secret` | placeholder | JWT for OnlyOffice document tokens |
| `onlyoffice_file_token_secret` | placeholder | Separate secret for file-access tokens |
| `onlyoffice_file_token_ttl` | 60 | Token validity in seconds |
| `onlyoffice_internal_api_base_url` | http://api:8000 | How OnlyOffice reaches the API |

### Authentication
| Setting | Default | Purpose |
|---------|---------|---------|
| `jwt_access_token_expire_days` | 7 | Access token lifetime |
| `jwt_refresh_token_expire_days` | 31 | Refresh token lifetime |
| `frontend_url` | http://localhost:3000 | CORS origin, magic link base URL |

### CORS
| Setting | Default | Purpose |
|---------|---------|---------|
| `cors_allowed_headers` | (list) | Extended to include `X-Upload-ID`, `Upload-Checksum`, `Tus-Checksum-Algorithm` |

## Validation Rules

The `_check_onlyoffice_secrets` model validator enforces three critical security constraints at startup:

1. **`onlyoffice_jwt_secret`** must not be a known placeholder (blocks docker-compose defaults from reaching production)
2. **`onlyoffice_file_token_secret`** must not be a known placeholder
3. **The two secrets must differ** — the JWT secret is shared with the OnlyOffice container, while the file token secret is known only to the API. If they were the same, a compromised OnlyOffice container could forge file-download tokens.

If any of these checks fail, the application refuses to start with a descriptive error message.

## Properties

- `is_dev` → `True` when `environment == "development"`. Controls: Swagger UI, SQL echo, SQLAdmin, rate limit enforcement
- `cors_headers_list` → Splits the comma-separated `cors_allowed_headers` string into a list, with graceful fallback defaults

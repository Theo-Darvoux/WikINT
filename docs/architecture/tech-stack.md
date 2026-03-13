# Technology Stack

WikINT is built with a modern async Python backend and a React-based frontend, orchestrated via Docker Compose. This document details every technology choice and the rationale behind it.

---

## Backend

| Technology | Version | Purpose |
|-----------|---------|---------|
| **FastAPI** | 0.115+ | Async web framework. Native Pydantic validation, OpenAPI generation, dependency injection |
| **Uvicorn** | 0.34+ | ASGI server. Production runs behind Gunicorn with 4 Uvicorn workers |
| **Gunicorn** | 25.1+ | Process manager for production (multi-worker) |
| **SQLAlchemy** | 2.0+ | Async ORM with `asyncpg` driver. Mapped columns, relationships, JSONB support |
| **asyncpg** | 0.30+ | Native PostgreSQL async driver. Connection pool: 20 size, 10 overflow |
| **Alembic** | 1.14+ | Database migration management. Async-aware via custom `env.py` |
| **Pydantic** | 2.10+ | Request/response validation. `from_attributes` for ORM compat, discriminated unions for PR operations |
| **pydantic-settings** | 2.7+ | Environment-based configuration with `.env` file support |
| **PyJWT** | 2.9+ | JWT creation and verification (HS256). Access + refresh token architecture |
| **Redis** | 5.0+ | Async Redis client for rate limiting, token blacklist, and job queue |
| **ARQ** | 0.26+ | Async Redis-backed job queue. Cron scheduling for background tasks |
| **aioboto3** | 13.0+ | Async S3 client for MinIO operations (presigned URLs, file management) |
| **meilisearch-python-async** | 3.0+ | Async Meilisearch SDK for search index management and queries |
| **aioclamd** | 0.1+ | Async ClamAV client for virus scanning uploaded files |
| **aiosmtplib** | 3.0+ | Async SMTP client for sending verification emails |
| **slowapi** | 0.1.9+ | Rate limiting middleware backed by Redis |
| **sse-starlette** | 2.0+ | Server-Sent Events for real-time notification and annotation streaming |
| **sqladmin** | 0.23+ | Web-based database admin (dev mode only) |
| **Typer** | 0.15+ | CLI framework for admin commands (seed, reindex, gdpr-cleanup, year-rollover) |
| **httpx** | 0.28+ | Async HTTP client |

**Package management**: [uv](https://github.com/astral-sh/uv) — fast Python package installer and resolver. Lock file: `uv.lock`. Defined in `api/pyproject.toml`.

### Dev Dependencies

| Technology | Purpose |
|-----------|---------|
| **Ruff** 0.9+ | Linter and formatter. Rules: E, F, I, N, W, UP. Python 3.12 target, 100-char lines |
| **pytest** 8.0+ | Test framework with `pytest-asyncio` 0.24+ (auto mode) |
| **factory-boy** 3.3+ | Test data factories |
| **pytest-cov** 7.0+ | Coverage reporting |
| **aiosqlite** 0.22+ | SQLite async driver for in-memory test databases |

---

## Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Next.js** | 16.1+ | React framework with App Router, SSR, standalone output for Docker |
| **React** | 19.2+ | UI library |
| **TypeScript** | 5.x | Type safety across all frontend code |
| **Zustand** | 5.0+ | Lightweight state management. 5 stores: auth, UI, notifications, staging cart, selection |
| **shadcn/ui** | new-york style | UI component library built on Radix UI primitives |
| **Tailwind CSS** | 4.x | Utility-first CSS with OKLch color space variables |
| **Lucide React** | 0.575+ | Icon library (~200 icons used across the app) |
| **react-pdf** | 9.2+ | PDF rendering in the browser |
| **mammoth** | 1.11+ | DOCX → HTML conversion for Office file viewing |
| **xlsx** | 0.18+ | Excel file parsing and rendering |
| **highlight.js** | 11.11+ | Source code syntax highlighting (65+ language mappings) |
| **epub.js** | CDN | EPUB book reader (loaded dynamically) |
| **cmdk** | 1.1+ | Command palette / search UI (Cmd+K) |
| **date-fns** | 4.1+ | Date formatting and relative time display |
| **next-themes** | 0.4+ | Light/dark theme management |
| **sonner** | 2.0+ | Toast notifications |
| **react-diff-viewer-continued** | 4.1+ | PR diff visualization |
| **clsx** + **tailwind-merge** | — | Conditional class name composition |
| **class-variance-authority** | 0.7+ | Component variant management |

**Package management**: pnpm 10.32+. Lock file: `pnpm-lock.yaml`. Defined in `web/package.json`.

---

## Infrastructure

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Docker Compose** | v2 | Multi-service orchestration (11 services) |
| **PostgreSQL** | 16 | Primary relational database. UUID PK with `gen_random_uuid()`, JSONB columns |
| **Redis** | 7 | Cache, rate limiter, JWT blacklist, ARQ job queue. 256MB max, LRU eviction |
| **MinIO** | Latest | S3-compatible object storage. Self-hosted, presigned URL uploads/downloads |
| **Meilisearch** | 1.12 | Full-text search. Typo tolerance, multi-index, filterable attributes |
| **ClamAV** | Latest | Antivirus daemon. 1GB max scan size, TCP socket on port 3310 |
| **Nginx** | Alpine | Reverse proxy, SSL termination (Let's Encrypt), security headers, WebSocket upgrade |
| **Certbot** | Latest | SSL certificate management (Let's Encrypt) |

---

## Design Rationale

### Why FastAPI + async?
The platform handles file uploads, search queries, and real-time SSE — all I/O-bound operations that benefit from async. FastAPI's native async support with Pydantic validation and auto-generated OpenAPI docs made it a natural fit.

### Why Zustand over Redux/Context?
Zustand provides minimal boilerplate for 5 small, focused stores. The staging cart store uses localStorage persistence — a built-in Zustand middleware. No need for Redux's ceremony for this scale.

### Why MinIO over cloud S3?
Self-hosted for data sovereignty (academic institution context). MinIO is S3-compatible, so the codebase can migrate to AWS S3 by changing endpoint configuration.

### Why Meilisearch over Elasticsearch?
Lightweight, single-binary deployment. Built-in typo tolerance is essential for students searching course codes (e.g., "MA101" vs "MA 101"). Lower resource footprint than Elasticsearch.

### Why ARQ over Celery?
ARQ is async-native and uses Redis (already in the stack). Celery would require an additional broker and doesn't integrate as cleanly with the async codebase.

### Why presigned URLs for uploads?
Files go directly from browser to MinIO, bypassing the API server. This avoids memory pressure on the API for large files (up to 1GB) and allows progress tracking via XMLHttpRequest.

### Why Server-Sent Events over WebSocket?
SSE is simpler for the unidirectional notification/annotation event streams. No need for bidirectional communication. EventSource auto-reconnects on network drops. The multi-tab coordination via BroadcastChannel prevents duplicate connections.

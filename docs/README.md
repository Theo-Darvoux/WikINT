# WikINT Deep Technical Documentation

## Project Purpose

WikINT is a **course materials platform** built for Telecom SudParis / IMT-BS. It functions as a collaborative knowledge base where students upload, organize, review, and consume academic materials (PDFs, Office documents, images, audio, video, code files). Think of it as a student-run wiki where every content change goes through a **pull request review process** before being published to the browsable tree.

The platform serves a dual purpose:
1. **Knowledge preservation** across academic years (materials persist and version)
2. **Collaborative curation** where students collectively build and maintain a shared study resource library

## Architectural Overview

WikINT follows a **three-tier architecture** with a clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────────┐
│                        NGINX Reverse Proxy                       │
│            (TLS termination, path routing, rate limiting)         │
└──────┬──────────────────────┬───────────────────┬───────────────┘
       │                      │                   │
       ▼                      ▼                   ▼
┌──────────────┐    ┌──────────────────┐   ┌──────────────┐
│   Next.js    │    │   FastAPI (API)   │   │  OnlyOffice  │
│  Frontend    │    │   + ARQ Workers   │   │  Document    │
│  (SSR/CSR)   │    │                  │   │  Server      │
└──────────────┘    └───────┬──────────┘   └──────────────┘
                            │
              ┌─────────────┼─────────────────┐
              │             │                 │
              ▼             ▼                 ▼
        ┌──────────┐  ┌──────────┐     ┌──────────────┐
        │PostgreSQL│  │  Redis   │     │ MinIO / S3   │
        │  (data)  │  │(cache/   │     │ (file store) │
        │          │  │ queues)  │     │              │
        └──────────┘  └──────────┘     └──────────────┘
              │
              ▼
        ┌──────────────┐
        │ MeiliSearch  │
        │ (full-text)  │
        └──────────────┘
```

**Pattern:** Service-Oriented Monolith. The API is a single FastAPI application, but internally it is organized into distinct domains (routers, services, models) that could be extracted into separate services if needed. Background processing is handled by ARQ workers running the same codebase.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS | Next.js 15 |
| API | FastAPI, SQLAlchemy 2 (async), Pydantic v2 | Python 3.13 |
| Database | PostgreSQL (via asyncpg) | 15+ |
| Migrations | Alembic | |
| Cache / Queues | Redis (via redis-py async + ARQ) | |
| Object Storage | S3-compatible (MinIO dev, Cloudflare R2 prod) | |
| Search | MeiliSearch | |
| Malware Scanning | YARA rules + MalwareBazaar API | |
| Document Editing | OnlyOffice Document Server | |
| Observability | OpenTelemetry + Prometheus | |
| Reverse Proxy | Nginx | |

## Documentation Map

### Architecture
- [`architecture/system-overview.md`](architecture/system-overview.md) - System topology, service interactions, and deployment model
- [`architecture/data-model.md`](architecture/data-model.md) - Complete database schema, entity relationships, and migration history

### Modules

#### Core Infrastructure
- [`modules/core-infrastructure/storage.md`](modules/core-infrastructure/storage.md) - S3/MinIO object storage abstraction layer
- [`modules/core-infrastructure/database.md`](modules/core-infrastructure/database.md) - Async SQLAlchemy engine, session management, post-commit job pattern
- [`modules/core-infrastructure/redis.md`](modules/core-infrastructure/redis.md) - Redis clients, ARQ pool, pub/sub for SSE
- [`modules/core-infrastructure/configuration.md`](modules/core-infrastructure/configuration.md) - Environment-based settings, secret validation, per-type size limits
- [`modules/core-infrastructure/telemetry.md`](modules/core-infrastructure/telemetry.md) - OpenTelemetry traces, Prometheus metrics

#### Data Layer
- [`modules/data-layer/models.md`](modules/data-layer/models.md) - All SQLAlchemy ORM models, mixins, relationships
- [`modules/data-layer/schemas.md`](modules/data-layer/schemas.md) - Pydantic request/response schemas

#### API Endpoints
- [`modules/api-endpoints/authentication.md`](modules/api-endpoints/authentication.md) - Email OTP + magic link auth, JWT lifecycle
- [`modules/api-endpoints/upload.md`](modules/api-endpoints/upload.md) - Direct upload, presigned upload, TUS resumable protocol
- [`modules/api-endpoints/pull-requests.md`](modules/api-endpoints/pull-requests.md) - Batch PR creation, approval, voting
- [`modules/api-endpoints/browse.md`](modules/api-endpoints/browse.md) - Directory tree traversal, material retrieval
- [`modules/api-endpoints/remaining-routes.md`](modules/api-endpoints/remaining-routes.md) - Search, comments, annotations, flags, notifications, admin, OnlyOffice

#### Business Services
- [`modules/business-services/pr-engine.md`](modules/business-services/pr-engine.md) - Topological sort, operation dispatch, temp_id resolution
- [`modules/business-services/material-service.md`](modules/business-services/material-service.md) - Material CRUD, versioning, search indexing
- [`modules/business-services/user-service.md`](modules/business-services/user-service.md) - User lifecycle, roles, onboarding

#### Background Workers
- [`modules/background-workers/upload-pipeline.md`](modules/background-workers/upload-pipeline.md) - The 4-stage upload processing pipeline
- [`modules/background-workers/cleanup.md`](modules/background-workers/cleanup.md) - Orphan cleanup, stale upload cleanup, multipart reconciliation

#### Security
- [`security/file-security.md`](security/file-security.md) - Metadata stripping, malware scanning, sandbox, MIME validation
- [`security/authentication.md`](security/authentication.md) - JWT architecture, token blacklisting, RBAC
- [`security/upload-hardening.md`](security/upload-hardening.md) - Quarantine pattern, CAS dedup, quota enforcement

#### Frontend
- [`modules/frontend/overview.md`](modules/frontend/overview.md) - Next.js app structure, routing, state management
- [`modules/frontend/upload-system.md`](modules/frontend/upload-system.md) - Client-side upload orchestration, staging store, crypto utils

### Flows
- [`flows/upload-lifecycle.md`](flows/upload-lifecycle.md) - Complete file upload from browser to stored material
- [`flows/pull-request-lifecycle.md`](flows/pull-request-lifecycle.md) - PR creation, review, approval, and content materialization
- [`flows/authentication-flow.md`](flows/authentication-flow.md) - Login, token refresh, and session management

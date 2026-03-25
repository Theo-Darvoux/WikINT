# WikINT Documentation

Technical documentation for WikINT, a collaborative academic materials platform for Telecom SudParis / IMT-BS students.

**Stack**: FastAPI + SQLAlchemy (Python) | Next.js + React (TypeScript) | PostgreSQL | Redis | MinIO | Meilisearch | Docker Compose

---

## Architecture

System-level design, data model, and technology choices.

- [System Overview](./architecture/overview.md) -- Service topology, request lifecycle, auth flow, file upload flow, PR approval pipeline, SSE architecture
- [Data Model](./architecture/data-model.md) -- ER diagram, all 17 tables, design patterns (soft deletes, polymorphic associations, self-referential trees, JSONB)
- [Tech Stack](./architecture/tech-stack.md) -- Complete dependency inventory with versions and rationale

## API (Backend)

FastAPI routers, services, and business logic.

- [API Overview](./api/overview.md) -- 3-layer architecture, dependency injection, error handling, pagination, post-commit job pattern
- [Authentication](./api/authentication.md) -- Passwordless email login, JWT tokens, refresh flow, role hierarchy
- [Browse & Directories](./api/browse-and-directories.md) -- Path resolution algorithm, directory tree, recursive CTEs
- [Materials](./api/materials.md) -- Material lifecycle, versioning, attachments, file types
- [Pull Requests](./api/pull-requests.md) -- Batch operations, temp ID system, topological sort, voting, execution pipeline
- [Annotations](./api/annotations.md) -- Threading model, SSE real-time updates, material-scoped events
- [Comments](./api/comments.md) -- Polymorphic comment system, target types
- [Search](./api/search.md) -- Meilisearch indexing pipeline, split identifiers, multi-index search
- [Upload](./api/upload.md) -- Multipart upload flow, MIME magic byte detection, YARA + MalwareBazaar scanning
- [Notifications](./api/notifications.md) -- Notification types, SSE delivery, Redis queue system
- [Flags & Moderation](./api/flags-and-moderation.md) -- Flag lifecycle, moderation actions, moderator powers
- [Users](./api/users.md) -- Profiles, reputation, GDPR compliance, data export
- [Admin](./api/admin.md) -- Admin endpoints, access control, SQLAdmin dev interface

## Web (Frontend)

Next.js pages, React components, and state management.

- [Frontend Overview](./web/overview.md) -- Page routing, Zustand stores, API client, layout, theming
- [Authentication](./web/authentication.md) -- Login flow, useAuth hook, AuthGuard, token management
- [Browse](./web/browse.md) -- Directory listing, caching, material viewer integration
- [Viewers](./web/viewers.md) -- 9 file viewers (PDF, code, image, video, audio, markdown, etc.)
- [Pull Requests](./web/pull-requests.md) -- Staging system, review drawer, upload drawer, drag-and-drop
- [Annotations](./web/annotations.md) -- Text selection tooltip, annotation threads, real-time updates
- [Sidebar](./web/sidebar.md) -- 5-tab sidebar (details, chat, annotations, edits, actions), responsive behavior
- [Profiles](./web/profiles.md) -- Profile pages, contributions, reputation, settings
- [Admin Pages](./web/admin.md) -- Dashboard, user management, flag review, PR queue
- [Notifications](./web/notifications.md) -- Multi-tab SSE coordination, navbar bell, notification page

## Infrastructure

Docker services, configuration, and operational details.

- [Infrastructure Overview](./infrastructure/overview.md) -- Service topology, startup order, health checks, prod vs dev
- [Database (PostgreSQL)](./infrastructure/database.md) -- Connection pool, session management, schema, SQL views
- [File Storage (MinIO)](./infrastructure/storage.md) -- S3 client, presigned URLs, file organization, malware scanner integration
- [Search Engine (Meilisearch)](./infrastructure/search-engine.md) -- Index setup, document structure, typo tolerance, reindexing
- [Caching & Queues (Redis)](./infrastructure/caching-and-queues.md) -- ARQ queue, rate limiting, token blacklist, SSE queues
- [Reverse Proxy (Nginx)](./infrastructure/reverse-proxy.md) -- Routing, TLS, security headers, certbot
- [Background Workers (ARQ)](./infrastructure/background-workers.md) -- On-demand jobs, cron schedule, job dispatch pattern

## Guides

Step-by-step instructions for common operations.

- [Local Development Setup](./guides/local-setup.md) -- Prerequisites, quick start, hot reloading, useful commands
- [Deployment](./guides/deployment.md) -- Production setup, TLS certificates, backups, monitoring
- [CLI Reference](./guides/cli-reference.md) -- seed, reindex, gdpr-cleanup, year-rollover commands
- [Troubleshooting](./guides/troubleshooting.md) -- Common issues with startup, runtime, and data

## Configuration

- [Environment Variables](./configuration/environment-variables.md) -- Complete reference for all `.env` settings

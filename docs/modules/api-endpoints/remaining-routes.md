# Remaining API Endpoints

## Home (`/api/home`)
Aggregate home-page data endpoint. All routes require authentication (`CurrentUser`).

- `GET /api/home/` — Returns a `HomeResponse` combining all home-page sections in one request:
  - `featured` — Active `FeaturedItem`s (`start_at <= now <= end_at`), ordered by `priority` DESC. Each item embeds a full `MaterialDetail` including `current_version_info`.
  - `popular_today` — Top 8 root materials (no attachments) ordered by `views_today` DESC.
  - `popular_14d` — Top 8 root materials ordered by `views_14d` DESC (rolling 14-day counter).
  - `recent_prs` — 5 most recently opened `open` pull requests, with author hydrated.
  - `recent_favourites` — Current user's 6 most recently favourited materials, ordered by favourite `created_at` DESC.

- `GET /api/home/popular` — Paginated "see all" view for popular materials.
  - Query params: `period` (`"today"` | `"14d"`, default `"today"`), `limit` (1–50, default 20), `offset` (default 0)
  - Returns `list[MaterialDetail]` ordered by the selected counter DESC.
  - Only root materials (`parent_material_id IS NULL`) are included in both popularity endpoints.


## Comments (`/api/comments`)
Polymorphic comment system supporting threaded replies:
- `POST /api/comments` — Create comment on any target (material, directory, etc.) [Rate Limit: 10/min]. **Restriction**: Target must be a valid, persisted item (UUID). Drafts/Ghost items are not supported.
- `GET /api/comments?target_type=...&target_id=...` — List comments for a target
- `PUT /api/comments/{id}` — Edit own comment
- `DELETE /api/comments/{id}` — Delete own comment

## PR Comments (`/api/pull-requests/{id}/comments`)
Discussion threads on pull requests:
- `POST /api/pull-requests/{id}/comments` — Add a comment [Rate Limit: 10/min]
- `GET /api/pull-requests/{id}/comments` — List comments
- Supports `parent_id` for threaded replies

## Annotations (`/api/annotations`)
Document-level annotations with spatial coordinates:
- `POST /api/materials/{id}/annotations` — Create annotation on a material [Rate Limit: 10/min]. **Restriction**: Material must be a valid, persisted item (UUID). Drafts/Ghost items are not supported.
- `GET /api/materials/{id}/annotations` — List annotations for a material
- Annotations include `page_number` and `coordinates` (JSONB) for positioning

## Flags (`/api/flags`)
Content moderation reporting:
- `POST /api/flags` — Flag content (material, comment, user) with a reason. **Restriction**: Target must be a valid, persisted item (UUID). Drafts/Ghost items are not supported.
- `GET /api/flags` — List flags (moderator only)
- `PUT /api/flags/{id}` — Update flag status (resolve, dismiss)

## Notifications (`/api/notifications`)
User notification system:
- `GET /api/notifications` — List notifications for the current user
- `PATCH /api/notifications/{id}/read` — Mark as read
- `POST /api/notifications/read-all` — Mark all as read
- `GET /api/notifications/unread-count` — Quick count for badge display

Notifications are created by the system when:
- A PR the user authored is approved/rejected
- Someone comments on the user's PR

## Users (`/api/users`)
User profile management:
- `GET /api/users/me` — Current user profile
- `PUT /api/users/me` — Update profile (display_name, bio, academic_year, avatar_url)
- `POST /api/users/me/onboard` — Complete onboarding (set GDPR consent, onboarded=true)
- `GET /api/users/me/recently-viewed` — List of user's recently viewed materials
- `GET /api/users/me/favourites` — List of user's favourited materials
- `GET /api/users/{id}` — Public user profile
- `GET /api/users/{id}/contributions` — List a user's contributions (PRs)
- `DELETE /api/users/me` — Soft-delete account (sets `deleted_at`)

## Moderator (`/api/moderator`)
Moderation endpoints. Requires `moderator`, `bureau`, or `vieux` role.

- `GET /api/moderator/stats` — Platform stats (user count, materials, open PRs, open flags).
- `GET /api/moderator/directories` — Read-only list of all directories.
- `GET /api/moderator/featured` — List all featured items (no active-window filter), ordered by `start_at` DESC.
- `POST /api/moderator/featured` — Create a featured item. Body: `FeaturedItemCreate`.
- `PATCH /api/moderator/featured/{id}` — Partially update a featured item.
- `DELETE /api/moderator/featured/{id}` — Permanently delete a featured item.

## Admin (`/api/admin`)
Administrative endpoints. Requires `bureau` or `vieux` role only.

### User Management
- `GET /api/admin/users` — List all users with optional `role`, `search`, `page`, `limit` filters.
- `PATCH /api/admin/users/{id}/role` — Change a user's role (`?role=<role>`).
- `DELETE /api/admin/users/{id}` — Hard-delete a user (triggers GDPR cleanup).

### Dead Letter Queue
- `GET /api/admin/dlq` — List failed background jobs. `?resolved=true` to include resolved.
- `POST /api/admin/dlq/{id}/retry` — Re-enqueue job with original payload.
- `POST /api/admin/dlq/{id}/dismiss` — Mark job as resolved without retrying.

## Tags (`/api/tags`)
Tag management:
- `GET /api/tags` — List all tags with optional category filter
- Tags are created automatically when referenced in PR operations

## OnlyOffice (`/api/onlyoffice`)
Integration with OnlyOffice Document Server:
- `GET /api/onlyoffice/config/{material_id}` — Returns a signed document editor configuration
- `GET /api/onlyoffice/file/{material_id}` — File download endpoint called by OnlyOffice server

**Security model:**
- The editor config contains a JWT signed with `onlyoffice_jwt_secret` (shared with OnlyOffice)
- The file download URL contains a separate token signed with `onlyoffice_file_token_secret` (known only to the API)
- The file token has a short TTL (`onlyoffice_file_token_ttl`, default 60s)
- These two secrets MUST differ to prevent a compromised OnlyOffice container from forging file-download tokens

## Health
- `GET /api/health` — Returns `{"status": "ok"}` (no auth required)
- `GET /metrics` — Prometheus metrics (optional bearer token protection)

# User Service (`api/app/services/user.py`)

## Purpose

Manages the full user lifecycle: onboarding, profile management, contribution tracking, GDPR data export, and account deletion. The corresponding router (`api/app/routers/users.py`) exposes these operations under `/api/users`.

## Onboarding

### `onboard_user(db, user, display_name, academic_year, gdpr_consent)`

First-time setup after email verification. A user cannot interact with the platform (upload, create PRs, vote) until onboarded.

**Requirements:**
- `user.onboarded` must be `False` (prevents re-onboarding)
- `gdpr_consent` must be `True` (EU compliance)

**Sets:**
- `display_name`, `academic_year`
- `gdpr_consent = True`, `gdpr_consent_at = now()`
- `onboarded = True`

The `OnboardedUser` auth dependency in other routes will reject any user where `onboarded is False`.

## Profile Management

### `update_user_profile(db, user, ...)`

Updates display name, bio, academic year, and/or avatar.

**Avatar handling:**
1. If the new `avatar_url` starts with `uploads/`: the file is moved to a permanent `avatars/` prefix via `move_object()`
2. If the user already had an avatar in `avatars/`: the old avatar is deleted from S3
3. The final key (under `avatars/`) is stored in the user record

This ensures avatar files live outside the `uploads/` prefix and aren't caught by the 24-hour upload cleanup worker.

### `get_user_by_id(db, user_id)`

Loads a user by UUID, filtering out soft-deleted users (`deleted_at IS NULL`).

## User Statistics

### `get_user_stats(db, user_id)`

Returns aggregated contribution metrics:

| Metric | Query |
|--------|-------|
| `prs_approved` | Count of PRs with status `APPROVED` |
| `prs_total` | Total PRs authored |
| `annotations_count` | Total annotations authored |
| `comments_count` | Total comments authored |
| `open_pr_count` | PRs currently `OPEN` |
| `reputation` | `prs_approved * 10 + annotations_count * 2` |

The reputation formula is intentionally simple — it incentivizes content contributions (PRs) more than annotations.

## Contributions

### `get_user_contributions(db, user_id, contribution_type, limit, offset)`

Paginated listing of a user's contributions, filterable by type:

| `contribution_type` | Returns |
|---------------------|---------|
| `"prs"` | `PullRequest` objects, ordered by `created_at desc` |
| `"materials"` | `Material` objects with current version info, ordered by `created_at desc` |
| `"annotations"` | `Annotation` objects, ordered by `created_at desc` |

Returns a tuple `(items, total_count)` for pagination.

## View History

### `get_recently_viewed(db, user_id, limit=10)`

Returns the user's most recently viewed materials, joined with their current `MaterialVersion` and parent `Directory`. Used to render the "Recently Viewed" section on the user's profile.

## GDPR Data Export

### `export_user_data(db, user)`

**Endpoint:** `GET /api/users/me/data-export`

Returns a complete JSON export of all user data, fulfilling GDPR Article 20 (right to data portability):

- **Profile:** ID, email, display name, bio, academic year, role, avatar, timestamps
- **Consent:** GDPR consent status and timestamp
- **Pull requests:** ID, title, type, status
- **Annotations:** ID, body, material reference
- **Votes:** ID, PR reference, value
- **Comments:** ID, body, target type
- **PR comments:** ID, body, PR reference
- **Flags:** ID, target type, reason
- **Notifications:** ID, type, title, body, read status, timestamp
- **View history:** ID, material reference, timestamp

## Account Deletion

### `soft_delete_user(db, user)`

**Endpoint:** `DELETE /api/users/me`

Performs GDPR-compliant soft deletion:

1. **Deletes avatar** from S3 (if present)
2. **Anonymizes** the user record:
   - `display_name` → `"Deleted User"`
   - `bio`, `avatar_url`, `academic_year` → `None`
   - `gdpr_consent` → `False`, `gdpr_consent_at` → `None`
   - `onboarded` → `False`
3. **Sets** `deleted_at` to current timestamp

The user's `email` is preserved (needed for foreign key integrity with PRs, comments, etc.), but the `deleted_at` filter in `get_user_by_id` ensures the user cannot be loaded or logged in again.

Content created by the user (PRs, materials, annotations) is **not deleted** — it remains in the system attributed to "Deleted User".

## Router Endpoints Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/users/me/onboard` | Required | First-time user setup |
| `GET` | `/api/users/me` | Required | Current user profile with stats |
| `PATCH` | `/api/users/me` | Required | Update profile fields |
| `GET` | `/api/users/me/recently-viewed` | Required | Recent view history |
| `GET` | `/api/users/me/data-export` | Required | GDPR data export |
| `DELETE` | `/api/users/me` | Required | Soft-delete account |
| `GET` | `/api/users/{user_id}` | None | Public profile with stats |
| `GET` | `/api/users/{user_id}/avatar` | None | Presigned redirect to avatar |
| `GET` | `/api/users/{user_id}/contributions` | None | Paginated contributions |

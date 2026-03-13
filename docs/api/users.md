# Users

The user system manages profiles, onboarding, reputation, contribution tracking, and GDPR-compliant data handling. Users authenticate via email and must complete onboarding before contributing.

**Key files**: `api/app/routers/users.py`, `api/app/services/user.py`, `api/app/models/user.py`, `api/app/schemas/user.py`

---

## Onboarding

New users must complete onboarding before they can create annotations, comments, or PRs:

### POST `/api/users/me/onboard`

**Auth**: Required. **Request** (`OnboardIn`):
```json
{
  "display_name": "Alice Dupont",
  "academic_year": "2A",
  "gdpr_consent": true
}
```

**Validation**:
- `academic_year` must be `"1A"`, `"2A"`, or `"3A+"`
- `gdpr_consent` must be `true`
- User must not already be onboarded

**Effect**: Sets `display_name`, `academic_year`, `gdpr_consent=True`, `gdpr_consent_at=now()`, `onboarded=True`.

---

## Profile Endpoints

### GET `/api/users/me`
Returns the current user's profile with reputation stats.

**Response** (`UserProfileOut`):
```json
{
  "id": "uuid", "email": "alice@telecom-sudparis.eu",
  "display_name": "Alice Dupont", "avatar_url": "avatars/uuid/pic.jpg",
  "role": "student", "bio": "2A student at TSP",
  "academic_year": "2A", "onboarded": true,
  "created_at": "2026-01-15T...",
  "prs_approved": 5, "prs_total": 8,
  "annotations_count": 12, "comments_count": 7,
  "open_pr_count": 2, "reputation": 74
}
```

### PATCH `/api/users/me`
**Auth**: Required. Updates optional fields: `display_name`, `bio`, `academic_year`, `avatar_url`. Only provided fields are updated.

### GET `/api/users/{user_id}`
Public profile with stats. No auth required.

### GET `/api/users/{user_id}/avatar`
Redirects (302) to a presigned MinIO URL for the user's avatar image. Returns 404 if no avatar set.

### GET `/api/users/{user_id}/contributions`

**Query params**: `type` (required: `"prs"`, `"materials"`, or `"annotations"`), `page`, `limit`

Returns paginated contributions of the specified type, ordered by `created_at DESC`.

### GET `/api/users/me/recently-viewed`
Returns the last 10 materials the user viewed, ordered by `viewed_at DESC`. Includes `directory_path` for each material.

---

## Reputation System

Reputation is calculated in `api/app/services/user.py:get_user_stats`:

```
reputation = (prs_approved * 10) + (annotations_count * 2)
```

| Stat | Query |
|------|-------|
| `prs_approved` | COUNT of PRs with `status=APPROVED` |
| `prs_total` | COUNT of all PRs by user |
| `annotations_count` | COUNT of all annotations by user |
| `comments_count` | COUNT of all comments by user |
| `open_pr_count` | COUNT of PRs with `status=OPEN` |

---

## GDPR Compliance

### Data Export

**GET `/api/users/me/data-export`** returns a comprehensive JSON export:

```json
{
  "profile": { "id": "...", "email": "...", "display_name": "...", ... },
  "consent": { "gdpr_consent": true, "gdpr_consent_at": "..." },
  "pull_requests": [...],
  "annotations": [...],
  "votes": [...],
  "comments": [...],
  "pr_comments": [...],
  "flags": [...],
  "notifications": [...],
  "view_history": [...]
}
```

### Account Deletion

**DELETE `/api/users/me`** performs a soft delete:

1. Sets `deleted_at = now()`
2. Anonymizes: `display_name = "Deleted User"`, clears `bio`, `avatar_url`, `academic_year`
3. Sets `gdpr_consent = False`

The user is immediately inaccessible (queries filter `WHERE deleted_at IS NULL`). After 30 days, the `gdpr_cleanup` background worker hard-deletes the record.

**Important**: Content created by the user (annotations, materials, PRs) is retained per the privacy policy — users grant an irrevocable license to their contributions.

---

## Academic Year Rollover

The `year_rollover` cron job (runs September 1 at 2:00 AM) automatically promotes users:

| Current | New |
|---------|-----|
| 1A | 2A |
| 2A | 3A+ |
| 3A+ | 3A+ (unchanged) |

See `api/app/workers/year_rollover.py`.

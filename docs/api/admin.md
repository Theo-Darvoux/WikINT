# Admin

The admin API provides site-wide statistics, user management, and directory overview for moderators and administrators.

**Key files**: `api/app/routers/admin.py`

---

## Access Control

| Endpoint | Required Role |
|----------|---------------|
| `GET /api/admin/stats` | MEMBER, BUREAU, or VIEUX |
| `GET /api/admin/users` | MEMBER, BUREAU, or VIEUX |
| `PATCH /api/admin/users/{id}/role` | BUREAU or VIEUX only |
| `DELETE /api/admin/users/{id}` | BUREAU or VIEUX only |
| `GET /api/admin/directories` | MEMBER, BUREAU, or VIEUX |

---

## Endpoints

### GET `/api/admin/stats`

Returns site-wide counters.

```json
{
  "user_count": 150,
  "material_count": 423,
  "open_pr_count": 12,
  "open_flag_count": 3
}
```

### GET `/api/admin/users`

**Query params**: `role` (optional), `search` (optional — case-insensitive on email + display_name), `page`, `limit` (max 100)

```json
{
  "items": [
    {
      "id": "uuid", "email": "alice@telecom-sudparis.eu",
      "display_name": "Alice", "role": "student",
      "onboarded": true, "created_at": "..."
    }
  ],
  "total": 150, "page": 1, "pages": 3
}
```

### PATCH `/api/admin/users/{user_id}/role`

**Auth**: BUREAU or VIEUX only. **Query param**: `role` (must be valid UserRole value).

Changes the user's role. Used for promoting students to moderators or revoking privileges.

**Response**: `{"status": "ok", "role": "member"}`

### DELETE `/api/admin/users/{user_id}`

**Auth**: BUREAU or VIEUX only.

Soft-deletes the user (sets `deleted_at`). Same mechanism as self-deletion — the user is anonymized and hard-deleted after 30 days.

### GET `/api/admin/directories`

Returns a flat list of all directories ordered by `sort_order` then `name`.

```json
[
  {"id": "uuid", "name": "1A", "slug": "1a", "type": "module", "parent_id": null, "is_system": false},
  {"id": "uuid", "name": "S1", "slug": "s1", "type": "folder", "parent_id": "uuid", "is_system": false}
]
```

---

## SQLAdmin (Dev Only)

In development mode (`settings.is_dev`), `api/app/main.py` registers a SQLAdmin interface providing a web UI for browsing and editing database records directly. ModelViews are registered for: User, Directory, Material, MaterialVersion, Tag, Annotation, Comment, PullRequest, Notification.

This is disabled in production.

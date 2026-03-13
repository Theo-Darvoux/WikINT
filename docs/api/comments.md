# Comments

The comment system provides general-purpose discussion on materials and directories. Unlike annotations (which are position-anchored on documents), comments are freeform conversations attached to entities.

**Key files**: `api/app/routers/comments.py`, `api/app/services/comment.py`, `api/app/models/comment.py`, `api/app/schemas/comment.py`

---

## Design

Comments use a **polymorphic association** pattern: the `(target_type, target_id)` tuple links a comment to any entity without foreign key constraints. Currently supported targets: `"directory"` and `"material"`.

An index on `(target_type, target_id, created_at)` optimizes the primary query pattern.

---

## Endpoints

### GET `/api/comments`

**Query params**: `targetType` (required), `targetId` (required), `page`, `limit`

```json
{
  "items": [
    {
      "id": "uuid",
      "target_type": "material",
      "target_id": "uuid",
      "author_id": "uuid",
      "author": {"id": "uuid", "display_name": "Alice", "avatar_url": null},
      "body": "Great resource, thanks for uploading!",
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "total": 3, "page": 1, "pages": 1
}
```

Comments are ordered by `created_at ASC` (chronological).

### POST `/api/comments`

**Auth**: OnboardedUser required.

**Request** (`CommentCreateIn`):
```json
{
  "target_type": "directory",
  "target_id": "uuid",
  "body": "Should we reorganize this folder?"
}
```

- `target_type` must be `"directory"` or `"material"` (Literal type)
- `body`: 1-10000 characters
- Validates target entity exists before creating

**Response**: `CommentOut` (201 Created)

### PATCH `/api/comments/{comment_id}`

**Auth**: Required (author only). Updates `body` and `updated_at`.

### DELETE `/api/comments/{comment_id}`

**Auth**: Required. Author can delete own comments. Moderators (MEMBER/BUREAU/VIEUX) can delete any comment.

**Response**: 204 No Content

---

## Comments vs. Annotations

| Aspect | Comments | Annotations |
|--------|----------|-------------|
| Target | Any entity (directory, material) | Materials only |
| Positioning | Not position-anchored | Anchored to text/page coordinates |
| Threading | Flat list (no threading) | Threaded (root + replies) |
| Real-time | No SSE | SSE broadcast on create/delete |
| Body limit | 10000 chars | 1000 chars |
| UI location | Sidebar "Chat" tab | Sidebar "Annotations" tab + inline on document |

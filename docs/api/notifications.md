# Notifications

WikINT provides in-app notifications delivered via REST endpoints and real-time Server-Sent Events. Notifications are triggered by PR actions, annotation replies, flag resolutions, and other collaborative events.

**Key files**: `api/app/routers/notifications.py`, `api/app/services/notification.py`, `api/app/core/sse.py`, `api/app/dependencies/auth.py` (SSEUser), `api/app/models/notification.py`, `api/app/schemas/notification.py`

---

## Notification Types

| Type | Trigger | Link Target |
|------|---------|-------------|
| `pr_approved` | PR approved by moderator or vote threshold | PR detail page |
| `pr_rejected` | PR rejected by moderator | PR detail page |
| `pr_voted` | Someone votes on your PR | PR detail page |
| `annotation_reply` | Reply to your annotation | Material page |
| `pr_comment_reply` | Reply to your PR comment | PR detail page |
| `flag_resolved` | Your flag is resolved/dismissed | — |
| `new_flag` | New flag created (sent to all moderators) | Admin flags page |

---

## Endpoints

### GET `/api/notifications`

**Auth**: Required. **Query params**: `read` (boolean, optional filter), `page`, `limit`

**Response**: `PaginatedResponse[NotificationOut]`
```json
{
  "items": [{
    "id": "uuid", "user_id": "uuid",
    "type": "pr_approved", "title": "Your PR was approved",
    "body": "\"Add MA101 materials\" has been merged",
    "link": "/pull-requests/uuid",
    "read": false, "created_at": "..."
  }],
  "total": 12, "page": 1, "pages": 2
}
```

### PATCH `/api/notifications/{notification_id}/read`

**Auth**: Required. Marks a single notification as read.

### POST `/api/notifications/read-all`

**Auth**: Required. Marks all unread notifications for the current user as read.

**Response**: `{"marked": 5}` (number of notifications updated)

### GET `/api/notifications/sse?token=`

Real-time notification stream. The JWT token is passed as a **query parameter** because the browser's `EventSource` API cannot send custom headers.

**Token validation**:
1. Decode JWT, verify signature
2. Check `type == "access"`
3. Check JTI not blacklisted in Redis
4. Fetch user from database

**Event stream**:
```
event: notification
data: {"id":"uuid","type":"pr_approved","title":"...","body":"...","link":"/pull-requests/uuid"}

event: ping
data: {}
```

The endpoint keeps the connection open, sending `ping` events every 30 seconds as keepalive. When a notification is created for this user, it's pushed through the queue immediately.

---

## SSE Architecture

SSE queue management lives in `api/app/core/sse.py`, separated from notification business logic in `api/app/services/notification.py`. Authentication for the SSE endpoint uses the `SSEUser` dependency from `api/app/dependencies/auth.py`, which validates a JWT passed as a query parameter (since `EventSource` cannot send headers).

```mermaid
graph TD
    subgraph "api/app/core/sse.py"
        Q["_user_queues<br/>Dict[user_id → List[asyncio.Queue]]"]
    end

    R1["/notifications/sse (Tab 1)"] -->|register_user_queue| Q
    R2["/notifications/sse (Tab 2)"] -->|register_user_queue| Q

    S1["create_notification()"] -->|broadcast_to_user()| Q
    S2["notify_user()"] -->|create_notification()| S1
    S3["notify_moderators()"] -->|batch add| DB[(Database)]
    S3 -->|for each mod| S2

    Q -->|sse_event_stream()| R1
    Q -->|sse_event_stream()| R2
```

- `register_user_queue(user_id)`: Creates a new `asyncio.Queue` and adds it to the list for that user in `_user_queues`. Supports multiple concurrent connections per user.
- `unregister_user_queue(user_id, queue)`: Removes the specific queue from the user's list on connection close.
- `broadcast_to_user(user_id, event)`: Puts event dict into **all** registered queues for the user. Fire-and-forget (`put_nowait`).
- `sse_event_stream(queue, cleanup, event_name, keepalive_seconds)`: Reusable async generator shared by all SSE endpoints. Yields events from the queue, sends `ping` keepalives on timeout, and calls `cleanup` on disconnect.

### Helper Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `create_notification(db, user_id, type, title, body, link)` | `notification.py` | Persists to DB + broadcasts via SSE |
| `notify_user(db, user_id, type, title, body, link)` | `notification.py` | Convenience wrapper around `create_notification` |
| `notify_moderators(db, type, title, body, link)` | `notification.py` | Fetches all MEMBER/BUREAU/VIEUX users, batches DB inserts, and broadcasts to each |

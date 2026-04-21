# Admin Panel & Auth Modularization Plan

## Context

- Current `/admin` panel → becomes `/moderator` (all existing features stay)
- New `/admin` panel → BUREAU/VIEUX only, holds config + user management + DLQ
- Auth: hardcoded TOTP for `@telecom-sudparis.eu` / `@imt-bs.eu` → DB-backed, pluggable providers

---

## Phase 1 — Admin/Moderator Split

**Goal:** Rename current panel to moderator, create empty admin shell.

### Backend
- No changes needed — existing `require_moderator()` and `require_role(BUREAU, VIEUX)` already correct.
- Add new router `api/app/routers/admin_config.py` (empty, will fill in Phase 2).
- Move `PATCH /admin/users/{id}/role`, `DELETE /admin/users/{id}`, all DLQ routes from `routers/admin.py` into new `routers/admin_config.py` under prefix `/api/admin-config`.
  - Gate everything with `require_role(UserRole.BUREAU, UserRole.VIEUX)`.

### Frontend
- Rename `web/src/app/admin/` → `web/src/app/moderator/`
  - Update all internal links and `pathname` checks in `layout.tsx`.
  - Update navbar/any link pointing to `/admin/*`.
- Create `web/src/app/admin/` fresh:
  - `layout.tsx`: guard with `role === "bureau" || role === "vieux"` only.
  - `page.tsx`: placeholder dashboard.
  - `users/page.tsx`: move from moderator panel.
  - `dlq/page.tsx`: move DLQ UI from moderator panel (currently doesn't exist in frontend — build it).
  - `config/page.tsx`: placeholder for Phase 2.

### Checklist
- [ ] Move backend user-management + DLQ routes to new router
- [ ] Create `/moderator` frontend (copy of current `/admin`)
- [ ] Create `/admin` frontend shell (BUREAU/VIEUX guard)
- [ ] Move Users + DLQ pages to `/admin`
- [ ] Update all internal route references
- [ ] Update docs: `docs/modules/api-endpoints/remaining-routes.md`, `docs/modules/frontend/overview.md`

---

## Phase 2 — DB-Backed Auth Config

**Goal:** Replace hardcoded domains with DB models editable from admin panel.

### New DB Models

#### `AuthConfig` (global, single row)
```
id                  UUID PK
totp_enabled        bool  default=true   # TOTP provider active
google_oauth_enabled bool default=false  # Google OAuth active
open_registration   bool  default=false  # Any email can request TOTP (no domain list)
created_at          datetime
updated_at          datetime
```

#### `AllowedDomain`
```
id           UUID PK
domain       str unique  # e.g. "telecom-sudparis.eu" (no @ prefix)
auto_approve bool default=true
created_at   datetime
```

### Migration
- Seed `AllowedDomain` with `telecom-sudparis.eu` (auto_approve=true) and `imt-bs.eu` (auto_approve=true).
- Seed `AuthConfig` with `totp_enabled=true`, everything else false.
- Delete hardcoded `ALLOWED_DOMAINS` in `services/auth.py` and `schemas/auth.py`.

### Auth Service Changes (`services/auth.py`)
- `validate_email(email)`: fetch `AllowedDomain` list from DB (cache in Redis, TTL 60s). If `open_registration=true`, skip domain check entirely. If domain found → pass. Else → reject.
- Return domain's `auto_approve` flag alongside validation result (needed in Phase 3).

### Admin API (`routers/admin_config.py`)
```
GET    /api/admin-config/auth           → current AuthConfig
PATCH  /api/admin-config/auth           → update AuthConfig fields
GET    /api/admin-config/auth/domains   → list AllowedDomain
POST   /api/admin-config/auth/domains   → add domain
PATCH  /api/admin-config/auth/domains/{id} → update domain (auto_approve)
DELETE /api/admin-config/auth/domains/{id} → remove domain
```
All gated with `require_role(BUREAU, VIEUX)`.

### Admin Frontend (`/admin/config/`)
- Toggle switches: TOTP enabled, Google OAuth enabled, Open registration.
- Domain table: list, add, delete, toggle auto_approve per domain.

### Checklist
- [ ] Create `models/auth_config.py` with `AuthConfig` + `AllowedDomain`
- [ ] Alembic migration + seed
- [ ] Refactor `validate_email()` to be DB-driven
- [ ] Add Redis cache for domain list
- [ ] Add admin config routes
- [ ] Build `/admin/config` frontend page
- [ ] Update docs: `docs/security/authentication.md`, `docs/modules/core-infrastructure/configuration.md`

---

## Phase 3 — PENDING State & Approval Flow

**Goal:** Domains with `auto_approve=false` (or open_registration with any email) block access until admin approves.

### Backend

#### UserRole enum change (`models/user.py`)
```python
class UserRole(enum.StrEnum):
    PENDING    = "pending"    # NEW — awaiting admin approval
    STUDENT    = "student"
    MODERATOR  = "moderator"
    BUREAU     = "bureau"
    VIEUX      = "vieux"
```

#### `get_or_create_user()` changes (`services/auth.py`)
- On new user creation: if domain `auto_approve=false` OR open_registration user → set role=PENDING.
- If `auto_approve=true` → set role=STUDENT (current behavior).
- After creating PENDING user: call `notify_admins_pending_user(user)`.

#### `notify_admins_pending_user(user)` (`services/notification.py`)
- Query all users with role BUREAU or VIEUX.
- Call `notify_user()` for each with:
  - type: `pending_user`
  - title: `New user pending approval`
  - body: `{email} is requesting access.`
  - link: `/admin/users/pending`
- Add `pending_user` to notification type map in frontend.

#### Token issuance
- PENDING users still get tokens (so they can hit `/api/users/me`).
- All other routes: add PENDING check in `get_current_user()` — if role=PENDING, raise 403 with code `USER_PENDING`.

#### New admin endpoints (`routers/admin_config.py`)
```
GET   /api/admin-config/users/pending          → paginated list of PENDING users
POST  /api/admin-config/users/{id}/approve     → set role=STUDENT, notify user
POST  /api/admin-config/users/{id}/reject      → hard delete user, optional reason
```

### Frontend

#### PENDING gate (`web/src/components/auth-guard.tsx`)
- After auth check: if `user.role === "pending"` → redirect to `/pending-approval`.
- New page `web/src/app/pending-approval/page.tsx`:
  - Static page: "Your account is pending admin approval. You'll be notified when approved."
  - No nav, no app access.

#### Admin pending users (`/admin/users/pending` or tab in `/admin/users`)
- List of pending users: email, requested_at (created_at), approve/reject buttons.
- Reject shows reason input (optional).

#### Notification type icon
- Add `pending_user` icon in `notifications/page.tsx` type map.

### Checklist
- [ ] Add `PENDING` to `UserRole` enum + migration
- [ ] Update `get_or_create_user()` to assign PENDING when appropriate
- [ ] Block PENDING users at `get_current_user()` with 403
- [ ] `notify_admins_pending_user()` function
- [ ] Approve/reject endpoints
- [ ] `/pending-approval` page
- [ ] Auth guard PENDING redirect
- [ ] Pending users list in admin panel
- [ ] Notification type icon for `pending_user`
- [ ] Update docs: `docs/security/authentication.md`, `docs/flows/authentication-flow.md`, `docs/modules/data-layer/models.md`

---

## Phase 4 — Google OAuth

**Goal:** Add Google as an auth provider, toggled via `AuthConfig.google_oauth_enabled`.

### Backend

#### Config additions (`config.py`)
```
google_oauth_client_id     str | None
google_oauth_client_secret str | None
```

#### New routes (`routers/auth.py`)
```
GET  /api/auth/google          → redirect to Google OAuth consent screen
GET  /api/auth/google/callback → handle code exchange, get email, run get_or_create_user()
```
- Use `authlib` or `httpx` + manual OAuth2 flow (no heavy lib preferred).
- After callback: same flow as TOTP verify — issue tokens, set cookie.
- If `google_oauth_enabled=false` → 404.
- Domain validation still applies: email domain must be in `AllowedDomain` OR `open_registration=true`.
  - If domain not allowed → reject with clear error.
  - If allowed but `auto_approve=false` → PENDING flow (Phase 3).

#### Admin config (`/api/admin-config/auth PATCH`)
- Toggle `google_oauth_enabled`.
- Store `google_oauth_client_id` + `google_oauth_client_secret` via admin config endpoint (write to env/secrets, not DB — client secrets shouldn't sit in plain DB rows).
  - Alternative: store encrypted in DB. Decide at implementation time.

### Frontend

#### Login page
- Show "Continue with Google" button only if `google_oauth_enabled=true`.
- Fetch auth config on login page load from public endpoint `GET /api/auth/config` (new, returns `{totp_enabled, google_oauth_enabled}`).

#### Admin config page
- Toggle for Google OAuth.
- Input fields for client ID + secret (write-only display).

### Checklist
- [ ] Add Google OAuth config fields to `config.py`
- [ ] Implement OAuth2 routes (redirect + callback)
- [ ] Public `GET /api/auth/config` endpoint
- [ ] Google button on login page (conditional)
- [ ] Admin toggle + credential input
- [ ] Update docs: `docs/security/authentication.md`, `docs/flows/authentication-flow.md`, `docs/modules/api-endpoints/authentication.md`

---

## Phase 5 — Future Auth Methods (Deferred)

Document scope, do not implement yet.

- **TOTP open mode**: already handled by `open_registration` flag in Phase 2.
- **Email + password**: needs password hashing (bcrypt), password reset flow (email token), "forgot password" page. Significant scope — separate plan.
- **SAML/SSO**: for institutional SSO (e.g. CAS). Even larger scope.
- **Invite system**: admin generates invite link → bypasses domain check, one-time use token.

---

## Dependency Order

```
Phase 1 (panel split)
    ↓
Phase 2 (DB auth config)       ← unblocks Phase 3 + 4
    ↓              ↓
Phase 3 (PENDING)   Phase 4 (Google OAuth)
    ↓
Phase 5 (future, deferred)
```

Phase 1 and 2 can be done in parallel. Phase 3 and 4 both depend on Phase 2 and can be done in parallel.

---

## Open Questions / Decisions

- **OAuth client secret storage**: encrypted DB column vs environment variable managed via admin UI writing to `.env`? Decide in Phase 4.
- **PENDING user email**: should user receive a "we received your request" email on signup? Not specified — add if desired.
- **Rejection notification**: should rejected users get an email explaining why? Not specified.
- **Domain cache invalidation**: when admin adds/removes domain, Redis cache must be purged immediately (not wait TTL). Implement cache-bust on domain write.

# Authentication Flow

## Overview

WikINT uses **passwordless email-based authentication**. Users never create or manage passwords. Instead, they authenticate via a 6-digit OTP code or a magic link, both sent to the same email. After authentication, the system issues JWT access and refresh tokens.

## Flow Diagram

```
Browser                          API                           Redis              PostgreSQL
  │                               │                              │                     │
  │  POST /auth/request-code      │                              │                     │
  │  { email }                    │                              │                     │
  │──────────────────────────────▶│                              │                     │
  │                               │  Rate limit check            │                     │
  │                               │─────────────────────────────▶│                     │
  │                               │  Store code + magic token    │                     │
  │                               │─────────────────────────────▶│                     │
  │                               │  verify:{email} → code       │                     │
  │                               │  magic:{token} → email       │                     │
  │                               │                              │                     │
  │                               │  Send email (code + link)    │                     │
  │  { "message": "sent" }        │                              │                     │
  │◀──────────────────────────────│                              │                     │
  │                               │                              │                     │
  │  ── User enters code ──       │                              │                     │
  │                               │                              │                     │
  │  POST /auth/verify-code       │                              │                     │
  │  { email, code }              │                              │                     │
  │──────────────────────────────▶│                              │                     │
  │                               │  Verify code                 │                     │
  │                               │─────────────────────────────▶│                     │
  │                               │  Get/create user             │                     │
  │                               │────────────────────────────────────────────────────▶│
  │                               │  Issue JWT access + refresh  │                     │
  │  { access_token, user }       │                              │                     │
  │  Set-Cookie: refresh_token    │                              │                     │
  │◀──────────────────────────────│                              │                     │
```

## Phase 1: Code Request

**Endpoint:** `POST /api/auth/request-code`

**Input:** `{ "email": "user@telecom-sudparis.eu" }`

### Rate Limiting

Two layers of protection:

1. **Per-IP:ClientID rate limit:** 3 requests per 15 minutes
   - Key: `ratelimit:{IP}:{X-Client-ID}` (combining IP prevents NAT issues, client ID distinguishes users behind shared IP)
   - Disabled in development mode

2. **Per-email rate limit:** 3 codes per 10 minutes
   - Redis counter on `verify:count:{email}`
   - Prevents mailbombing a specific address

### Code Generation & Storage

1. Generate a cryptographically random 6-digit numeric code
2. Store in Redis: `verify:{email}` → code (TTL: 10 minutes)
3. Generate a cryptographically random magic token (URL-safe string)
4. Store in Redis: `magic:{token}` → email (TTL: 15 minutes)

### Email Dispatch

A single email is sent containing:
- The 6-digit OTP code (for manual entry)
- A magic link URL: `{frontend_url}/login/verify?token={magic_token}`

### Response

Always returns `{"message": "Verification code sent"}` regardless of whether the email exists or delivery succeeded. This prevents **email enumeration attacks**.

## Phase 2: Code Verification

**Endpoint:** `POST /api/auth/verify-code`

**Input:** `{ "email": "user@telecom-sudparis.eu", "code": "123456" }`

### Verification Steps

1. Normalize email (lowercase, strip whitespace)
2. Check brute-force rate limit (attempt counter per email)
3. Retrieve stored code from Redis (`verify:{email}`)
4. Compare submitted code with stored code
5. **If invalid:** Increment attempt counter, return error
6. **If valid:** Reset attempt counter, delete code from Redis

### User Resolution

1. Look up user by email in PostgreSQL
2. **If not found:** Create a new `User` row with `role=student`, `onboarded=False`
3. Update `last_login_at` timestamp

### Token Issuance

1. **Access token** (JWT, 7-day expiry):
   ```json
   { "sub": "user-uuid", "role": "student", "email": "...", "jti": "token-uuid", "type": "access" }
   ```

2. **Refresh token** (JWT, 31-day expiry):
   ```json
   { "sub": "user-uuid", "jti": "token-uuid", "type": "refresh" }
   ```

Both signed with HS256 using `settings.secret_key.get_secret_value()`.

### Response

- **Body:** `{ "access_token": "...", "user": { id, email, display_name, role, onboarded } }`
- **Cookie:** `refresh_token` set as HTTP-only, Secure, SameSite=Strict, path=/api/auth/

## Phase 2b: Magic Link Verification (Alternative)

**Endpoint:** `POST /api/auth/verify-magic-link`

**Input:** `{ "token": "abc123..." }`

Same flow as code verification, but:
- Looks up email from Redis: `magic:{token}` → email
- Token is **single-use** (deleted from Redis after verification)
- The frontend's `/login/verify` page detects the `?token=` query parameter and automatically submits this endpoint
- `/login/verify` is treated as a **public route** by the `LayoutShell` auth guard — it is exempt from both the unauthenticated redirect to `/login` and the global loading-spinner overlay, so verification can complete before the user is authenticated

## Phase 3: Authenticated Requests

### Access Token Usage

Every API request includes the access token:
```
Authorization: Bearer <access_token>
```

The `get_current_user` dependency:
1. Extracts the Bearer token from the Authorization header
2. Decodes and validates the JWT
3. Verifies `type == "access"`
4. Checks `jti` against the Redis blacklist
5. Loads the user from PostgreSQL
6. Verifies `deleted_at IS NULL` (soft-deleted users rejected)

### SSE Authentication (Special Case)

The `EventSource` API cannot set custom headers. For SSE endpoints (upload progress), the JWT is passed as a query parameter:
```
GET /api/upload/events/{key}?token=<access_token>
```

The `QueryTokenUser` dependency handles this extraction.

## Phase 4: Token Refresh

**Endpoint:** `POST /api/auth/refresh`

### Flow

1. Extract refresh token from the HTTP-only cookie
2. Decode JWT, verify `type == "refresh"`
3. Check `jti` against Redis blacklist
4. **Blacklist the old refresh token** (remaining TTL stored in Redis)
5. Issue new access + refresh tokens
6. Set new refresh token cookie

### Rotation Security

This implements **refresh token rotation**:
- Each refresh token is single-use
- After rotation, the old refresh token is blacklisted
- If an attacker steals and uses a refresh token, the legitimate user's next refresh will fail (token already used/blacklisted), alerting them to compromise

## Phase 5: Logout

**Endpoint:** `POST /api/auth/logout`

1. Extract access token from Authorization header
2. Extract refresh token from cookie
3. Blacklist both tokens' `jti`s in Redis (remaining TTL)
4. Clear the refresh token cookie

### CSRF Protection

The `/auth/refresh` and `/auth/logout` endpoints require an `X-Client-ID` header. Since:
- Browser form submissions cannot set custom headers
- `EventSource` cannot set custom headers

This acts as lightweight CSRF protection without requiring CSRF tokens.

## Phase 6: Onboarding

**Endpoint:** `POST /api/users/me/onboard`

After first login, the user has `onboarded=False`. They must complete onboarding before accessing platform features:

1. Provide `display_name` and `academic_year`
2. Accept GDPR consent
3. Server sets `onboarded=True`, records consent timestamp

The `OnboardedUser` dependency blocks unonboarded users from content endpoints.

## Security Properties

| Property | Mechanism |
|----------|-----------|
| No password storage | Email-based OTP only |
| Brute-force protection | Per-email attempt counter + per-IP rate limit |
| Email enumeration prevention | Constant response regardless of email validity |
| Token theft mitigation | Refresh token rotation; blacklisting on use |
| XSS resilience | Refresh token in HTTP-only cookie; access token in memory (not localStorage) |
| CSRF protection | `X-Client-ID` header requirement; `SameSite=Strict` cookie |
| Session termination | Token blacklisting with exact TTL matching |

## Token Lifecycle Summary

```
Login:
  Access Token  ──── 7 days ────▶ Expires
  Refresh Token ──── 31 days ───▶ Expires

Refresh:
  Old Refresh   ──── blacklisted (remaining TTL)
  New Access    ──── 7 days ────▶
  New Refresh   ──── 31 days ───▶

Logout:
  Access Token  ──── blacklisted (remaining TTL)
  Refresh Token ──── blacklisted (remaining TTL)
```

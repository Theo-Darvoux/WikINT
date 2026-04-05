# Authentication Endpoints (`api/app/routers/auth.py`)

## Overview

All auth endpoints are mounted under `/api/auth/`. Rate limiting is applied per-endpoint using a combined IP + X-Client-ID key.

## Endpoints

### `POST /api/auth/request-code`
**Rate limit:** 3/15min (production), 10000/min (dev)

Sends a verification email containing both a 8-character OTP code and a magic link. The rate limit uses a composite key of `IP:X-Client-ID` to distinguish users behind NAT while preventing a single user from bypassing limits by changing client IDs alone.

**Internal flow:**
1. `auth_service.check_rate_limit(redis, email)` — Per-email rate limit (3/15min)
2. `auth_service.generate_code()` — 8-character alphanumeric code
3. `auth_service.store_code(redis, email, code)` — Redis SET with 15min TTL
4. `auth_service.generate_magic_token()` — Cryptographically random token
5. `auth_service.store_magic_token(redis, email, magic_token)` — Redis SET with 15min TTL
6. `send_verification_email(email, code, magic_link)` — SMTP send (fire-and-forget, logged on failure)

**Edge case:** Email sending failure is caught and logged but does NOT cause a 500 error. The user sees "Verification code sent" regardless. This prevents information leakage (an attacker can't determine if an email address has a valid mailbox).

### `POST /api/auth/verify-code`
**Response:** `TokenResponse` with access token, user brief, and `is_new_user` flag

Validates the OTP code and issues JWT tokens. The `is_new_user` flag tells the frontend whether to redirect to the onboarding flow.

**Security measures:**
- Verification attempt rate limiting (prevents brute-forcing the 8-character code)
- Failed attempts increment a counter; after too many, the user is locked out for 10 minutes
- Successful verification resets the counter
- `get_or_create_user` creates a new user if the email doesn't exist (self-registration)

### `POST /api/auth/verify-magic-link`
**Rate limit:** 10/15min

Same token issuance flow as verify-code, but validates a single-use magic token instead. The token is consumed (deleted from Redis) on first use.

### `POST /api/auth/refresh`
**Requires:** `X-Client-ID` header (CSRF protection), `refresh_token` cookie

Implements **token rotation:**
1. Extract refresh token from HTTP-only cookie
2. Validate JWT, check type is "refresh"
3. Check JTI against blacklist
4. **Blacklist the old refresh token** (with remaining TTL)
5. Issue new access + refresh tokens
6. Set new refresh token cookie

The old token blacklisting is critical: if an attacker steals a refresh token, they can use it once, but the legitimate user's next refresh attempt will fail (token already used and blacklisted), indicating a compromise.

### `POST /api/auth/logout`
**Requires:** `X-Client-ID` header, `Authorization: Bearer <token>`

Blacklists both the access token and the refresh token:
1. Extract access token from Authorization header → blacklist its JTI
2. Extract refresh token from cookie → blacklist its JTI
3. Delete the refresh token cookie (with matching security attributes)

**Error handling:** JWT decode failures during logout are silently caught. A partially-invalid logout is better than a 500 error that leaves the user confused about their session state.

## Dependencies Used

- `CurrentUser` — Authenticates the request (logout endpoint)
- `get_db` — Database session (user lookup/creation)
- `get_redis` — Redis client (code storage, rate limiting, blacklisting)
- `require_client_id` — CSRF protection dependency

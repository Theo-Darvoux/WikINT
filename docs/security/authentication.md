# Authentication & Authorization

## Authentication Architecture

WikINT uses a **passwordless email-based authentication** system. Users never create passwords. Instead, they authenticate via one of two methods:

1. **Email OTP (One-Time Password):** A 6-digit code sent to the user's email
2. **Magic Link:** A single-use URL sent to the same email

Both methods are sent in the same email, giving the user flexibility to either type a code or click a link.

## Authentication Flow

### 1. Code Request (`POST /api/auth/request-code`)

**Input:** `{ "email": "user@example.com" }`

**Process:**
1. Rate limit check: 3 requests per 15 minutes per IP:ClientID combo (disabled in dev)
2. Per-email rate limit: 3 codes per 10 minutes (checked via Redis counter)
3. Generate a 6-digit numeric code
4. Store code in Redis: `verify:{email}` → code, TTL 10 minutes
5. Generate a random magic token (cryptographically secure)
6. Store magic token in Redis: `magic:{token}` → email, TTL 15 minutes
7. Send email containing both the code and a magic link URL
8. Return `{"message": "Verification code sent"}` (always, even if email fails — prevents email enumeration)

**Rate Limiting Detail:** The `get_client_id` function combines `IP:X-Client-ID` to create the rate limit key. This ensures:
- Users behind NAT are distinguished by their client ID
- A single user can't bypass limits by just changing client IDs (the IP part persists)

## Chatting Rate Limiting

To prevent spam and abuse of discussion features, the following "chatting" endpoints are subject to a rate limit of **10 requests per minute** per user:

- `POST /api/comments` (Material/General comments)
- `POST /api/pull-requests/{id}/comments` (PR comments)
- `POST /api/materials/{id}/annotations` (Document annotations)

When a user exceeds this limit, the API returns a `429 Too Many Requests` response.

### 2. Code Verification (`POST /api/auth/verify-code`)

**Input:** `{ "email": "user@example.com", "code": "123456" }`

**Process:**
1. Normalize email (lowercase, strip whitespace)
2. Check verification attempt rate limit (prevents brute force)
3. Verify code against Redis-stored value
4. If invalid: increment attempt counter, raise error
5. If valid: reset attempt counter
6. Get or create user in PostgreSQL
7. Issue JWT access token (7-day expiry) and refresh token (31-day expiry)
8. Set refresh token as HTTP-only cookie
9. Return access token + user brief in response body

### 3. Magic Link Verification (`POST /api/auth/verify-magic-link`)

**Input:** `{ "token": "abc123..." }`

Same flow as code verification, but validates the token against Redis instead of a code. The token is single-use (deleted from Redis after verification).

## JWT Architecture (`api/app/core/security.py`)

### Token Types

**Access Token:**
```json
{
  "sub": "user-uuid",
  "role": "student",
  "email": "user@example.com",
  "jti": "unique-token-id",
  "exp": 1234567890,
  "type": "access"
}
```

**Refresh Token:**
```json
{
  "sub": "user-uuid",
  "jti": "unique-token-id",
  "exp": 1234567890,
  "type": "refresh"
}
```

Both use HS256 signing with `settings.secret_key.get_secret_value()`. The `jti` (JWT ID) is a UUID used for token revocation.

### Token Blacklisting

When a token is revoked (logout, refresh rotation), its `jti` is stored in Redis with a TTL equal to the token's remaining validity:

```python
await redis.set(f"blacklist:{jti}", "1", ex=remaining_seconds)
```

Every authenticated request checks the blacklist:
```python
if jti and await is_token_blacklisted(redis, jti):
    raise UnauthorizedError("Token has been revoked")
```

### Refresh Token Rotation

On `POST /api/auth/refresh`:
1. Extract refresh token from HTTP-only cookie
2. Validate JWT signature and type
3. Check blacklist
4. Blacklist the OLD refresh token (remaining TTL)
5. Issue NEW access + refresh tokens
6. Set new refresh token cookie

This rotation pattern means a stolen refresh token can only be used once. The legitimate user's next refresh will fail (old token blacklisted), alerting them to the compromise.

## Authorization (`api/app/dependencies/auth.py`)

### Dependency Chain

```python
CurrentUser = Annotated[User, Depends(get_current_user)]
```

`get_current_user` performs:
1. Extract `Authorization: Bearer <token>` header
2. Decode JWT
3. Verify `type == "access"`
4. Check JTI against blacklist
5. Load user from database
6. Verify `deleted_at is None` (soft-deleted users are rejected)

### Role-Based Access

```python
def require_role(*roles: UserRole):
    async def check_role(user: CurrentUser) -> User:
        if user.role not in roles:
            raise ForbiddenError("Insufficient permissions")
        return user
    return check_role
```

**Convenience dependencies:**
- `OnboardedUser` — Requires `user.onboarded == True`
- `require_moderator()` — Requires role in `{moderator, bureau, vieux}`

**Role hierarchy:**
| Role | Can upload | Can create PRs | Can approve PRs | Can admin |
|------|-----------|---------------|----------------|-----------|
| student | Yes | Yes | No | No |
| moderator | Yes | Yes | Yes | No |
| bureau | Yes | Yes | Yes | Yes |
| vieux | Yes | Yes | Yes | Yes |

### SSE Authentication

Server-Sent Events (EventSource API) cannot send custom headers. The `SSEUser` / `QueryTokenUser` dependency authenticates via query parameter instead:

```
GET /api/upload/events/quarantine/...?token=<jwt>
```

This uses the same JWT validation logic but extracts the token from `?token=` instead of the `Authorization` header.

### CSRF Protection

The `require_client_id` dependency on sensitive endpoints (refresh, logout) checks for the `X-Client-ID` header. Since EventSource and browser form submissions cannot set custom headers, this acts as a lightweight CSRF mitigation without requiring CSRF tokens.

## Cookie Security

Refresh tokens are stored as cookies with maximum security settings:
```python
response.set_cookie(
    key="refresh_token",
    value=refresh_token,
    httponly=True,       # Not accessible via JavaScript
    secure=True,         # HTTPS only
    samesite="strict",   # Not sent on cross-origin requests
    max_age=31*24*3600,  # 31 days
    path="/api/auth/",   # Only sent to auth endpoints
)
```

The `path="/api/auth/"` restriction is important — the refresh token cookie is only sent to auth-related endpoints, not to every API request. This minimizes the window for cookie theft.

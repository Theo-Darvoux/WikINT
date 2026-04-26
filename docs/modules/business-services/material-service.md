# Material & User Services

## Material Service (`api/app/services/material.py`)

Handles material CRUD operations and search indexing. Key functions:

### Material Retrieval
- `get_material_by_id(db, id)` — Load material with eager-loaded versions and tags
- `material_orm_to_dict(m, **kwargs)` — Convert Material ORM to a serializable dict
- `version_orm_to_dict(v)` — Convert MaterialVersion ORM to a serializable dict
- `get_material_by_slug(db, directory_id, slug)` — Resolve a material within a directory
- `get_materials_in_directory(db, directory_id)` — List all materials in a directory

### Versioning
- `get_current_version(db, material_id)` — Returns the latest `MaterialVersion`
- `get_version(db, material_id, version_number)` — Returns a specific version

### Search Indexing
- `index_material(material_id)` — Fetches material from DB, builds a search document, and upserts to MeiliSearch
- `index_directory(directory_id)` — Same for directories

Search documents include: id, title, slug, type, description, tag names, browse path, author info.

### Interactions
- `toggle_like(db, user_id, material_id)` — Toggle like status; atomic counter update.
- `toggle_favourite(db, user_id, material_id)` — Toggle bookmark status.
- **Restrictions**: Interactions are restricted for "draft" items (ID starting with `$`) and items viewed in Pull Request preview mode. The backend validates UUID integrity and raises `BadRequestError` for invalid IDs.

## User Service (`api/app/services/user.py`)

### User Retrieval
- `get_user_by_id(db, user_id)` — Primary lookup
- `get_user_by_email(db, email)` — For auth flow

### Profile Management
- `update_user(db, user_id, **fields)` — Partial update
- `soft_delete_user(db, user_id)` — Sets `deleted_at` (preserves data for GDPR compliance)

### Onboarding
- `complete_onboarding(db, user_id, gdpr_consent)` — Sets `onboarded=true`, records consent timestamp

## Email Service (`api/app/services/email.py`)

### `send_verification_email(email, code, magic_link)`

Sends the OTP verification email using `aiosmtplib`:
- Connects to SMTP server with optional STARTTLS
- Sends HTML email containing both the 6-digit code and the magic link URL
- Uses `asyncio` for non-blocking email delivery

## Auth Service (`api/app/services/auth.py`)

### Code Management
- `generate_code()` — Cryptographically random 6-digit numeric code
- `store_code(redis, email, code)` — Redis SET with 10-minute TTL
- `verify_code(redis, email, code)` — Constant-time comparison, deletes on success

### Magic Token Management
- `generate_magic_token()` — `secrets.token_urlsafe(32)`
- `store_magic_token(redis, email, token)` — Redis SET with 15-minute TTL
- `verify_magic_token(redis, token)` — Returns email if valid, deletes token (single-use)

### Rate Limiting
- `check_rate_limit(redis, email)` — Max 3 code requests per 10 minutes per email
- `check_verify_rate_limit(redis, email)` — Max verification attempts before lockout
- `increment_verify_rate_limit(redis, email)` — Increment on failed verification
- `reset_verify_rate_limit(redis, email)` — Reset on successful verification

### Token Operations
- `issue_tokens(user)` — Creates access + refresh JWT pair
- `blacklist_token(redis, jti, ttl)` — Adds JTI to Redis blacklist
- `is_token_blacklisted(redis, jti)` — Checks blacklist
- `get_or_create_user(db, email)` — Returns `(user, is_new)` tuple

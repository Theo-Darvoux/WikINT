# ORM Models (`api/app/models/`)

## Base Classes (`base.py`)

### `Base`
SQLAlchemy declarative base class. All models inherit from this.

### `UUIDMixin`
Adds a UUID primary key:
```python
id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid4)
```

### `TimestampMixin`
Adds auto-managed timestamps:
```python
created_at: Mapped[datetime]   # server_default=func.now()
updated_at: Mapped[datetime]   # server_default=func.now(), onupdate=func.now()
```

## Model Catalog

### User (`user.py`)
See [Data Model](../../architecture/data-model.md) for full schema.

**Key relationships:**
- `pull_requests` → One-to-many with PullRequest (as author)
- `annotations` → One-to-many with Annotation
- `comments` → One-to-many with Comment
- `notifications` → One-to-many with Notification (cascade delete)

**UserRole enum:** `student | member | bureau | vieux` — stored as PostgreSQL enum type.

### Directory (`directory.py`)
**Self-referential tree:**
- `parent` → Many-to-one with Directory (via `parent_id`)
- `children` → One-to-many with Directory (cascade delete-orphan)
- `materials` → One-to-many with Material (cascade delete-orphan)
- `tags` → Many-to-many via `directory_tags` junction table

**DirectoryType enum:** `module | folder`

**Unique constraint:** `(parent_id, slug)` — slugs are unique among siblings.

### Material (`material.py`)
**Key design decisions:**
- `directory_id` is **nullable** (root-level materials exist without a directory)
- `current_version` is denormalized — it's the latest version number, updated on each new version. This avoids a `MAX()` subquery on every material read.
- `parent_material_id` enables attachment hierarchies (materials can have child materials)
- `metadata_` is a JSONB column aliased to `metadata` in the database (Python `metadata` conflicts with SQLAlchemy internals)
- `download_count` is denormalized and incremented on each download
- `views_today` is reset to 0 daily by the `reset_daily_views` worker after being accumulated into `views_14d`
- `views_14d` is a rolling 14-day view counter, accumulated from `views_today` each midnight and zeroed on the 1st and 15th of each month by `reset_14d_views`

**Unique constraints:**
- `(directory_id, slug)` — standard uniqueness
- Partial index: `slug` unique WHERE `directory_id IS NULL` — ensures root-level slugs don't collide

### FeaturedItem (`featured.py`)

Curated items surfaced on the Home page within a configurable time window:

- `material_id` → Foreign key to `materials.id` (CASCADE delete)
- `title` / `description` → Optional override copy shown on the home card (falls back to the material's own title/description on the frontend when `None`)
- `start_at` / `end_at` → Timezone-aware window during which the item is active; the API filters `start_at <= now <= end_at`
- `priority` → Integer sort key; higher values surface first
- `created_by` → FK to `users.id` (SET NULL); audit trail of which moderator created the entry
- `created_at` → Immutable creation timestamp

**Relationships:**
- `material` → Many-to-one with Material (`lazy="joined"` — always loaded in a single query)
- `creator` → Many-to-one with User via `created_by`

**Indexes:**
- `ix_featured_items_window` on `(start_at, end_at)` — accelerates the active-window filter
- `ix_featured_items_priority` on `priority` — accelerates ORDER BY priority DESC

### MaterialVersion (`material.py`)
Tracks every version of a material's file:
- `file_key` — S3 object key (e.g., `materials/user-id/upload-id/file.pdf`)
- `file_size` — BigInteger (supports files > 2 GB)
- `thumbnail_key` — S3 object key for generated preview thumbnail (WebP)
- `virus_scan_result` — Enum: pending/clean/malicious (stored as VARCHAR(20) for flexibility)
- `pr_id` — Which PR introduced this version (audit trail)

**Unique constraint:** `(material_id, version_number)`

### PullRequest (`pull_request.py`)
The `payload` JSONB column stores an array of operation dicts. Each operation has an `op` field specifying the mutation type and relevant parameters. After PR approval, each operation is enriched with `result_id` and `result_browse_path` for post-approval navigation.

**PRStatus enum:** `open | approved | rejected`

**Relationships:**
- `comments` → One-to-many with PRComment (cascade delete-orphan)
- `author` → Many-to-one with User
- `reviewer` → Many-to-one with User (who approved/rejected)


### PRComment (`pull_request.py`)
- `parent_id` → Self-referential for threaded replies
- `body` → Text content

### Comment (`comment.py`)
Polymorphic comment system:
- `target_type` — e.g., "material", "directory"
- `target_id` — UUID of the target entity
- `parent_id` → Self-referential for threading

### Annotation (`annotation.py`)
Document-specific annotations:
- `material_id` → Foreign key
- `page_number` → Which page (for PDFs)
- `coordinates` → JSONB (position data for spatial annotations)
- `body` → Text content

### Tag (`tag.py`)
- `name` — Unique, lowercase
- `category` — Optional grouping
- Many-to-many with both Material and Directory via junction tables

### Flag (`flag.py`)
Content moderation:
- `target_type` / `target_id` — Polymorphic reference
- `reason` — User-provided reason
- `status` — Moderation workflow state

### Notification (`notification.py`)
- `type` — Notification category
- `title` / `message` — Display content
- `data` — JSONB for structured metadata
- `read` — Boolean

### ViewHistory (`view_history.py`)
- `user_id` + `material_id` — Tracks who viewed what
- `viewed_at` — Timestamp

### DownloadAudit (`download_audit.py`)
Audit trail for file downloads with user, material, timestamp, and IP.

### Upload (`upload.py`)
Lifecycle tracking for the upload pipeline:
- `upload_id` — External identifier (matches the one returned to the client)
- `quarantine_key` — S3 key where the file was initially stored
- `status` — pending/processing/clean/malicious/failed
- `sha256` / `content_sha256` — File hashes (original and post-processing)
- `final_key` — Where the processed file ended up
- `error_detail` — Why the upload failed (if applicable)
- `webhook_url` — Optional URL for webhook notification on completion

### Security (`security.py`)
Contains the `VirusScanResult` enum used by both MaterialVersion and PullRequest:
```python
class VirusScanResult(str, Enum):
    PENDING = "pending"
    CLEAN = "clean"
    MALICIOUS = "malicious"
```

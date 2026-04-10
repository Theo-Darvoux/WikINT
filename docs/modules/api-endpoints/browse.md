# Browse & Directory Endpoints

## Browse Router (`api/app/routers/browse.py`)

### `GET /api/browse`
Returns the root-level directory listing (top-level modules and folders).

### `GET /api/browse/{path:path}`
Resolves a slash-separated slug path (e.g., `math/linear-algebra/chapter-1`) to either:
- A **directory listing** (children directories + materials) if the path resolves to a directory
- A **material detail** if the path resolves to a material

The path resolution walks the directory tree from root, matching each slug segment against child directories, with the final segment potentially being a material within the last directory.

### `GET /api/browse/{path:path}/download`
Generates a presigned download URL for the material at the given path. Increments the material's `download_count` and creates a `DownloadAudit` record.

## Directory Router (`api/app/routers/directories.py`)

### `GET /api/directories`
Lists directories with optional parent_id filter.

### `GET /api/directories/{id}`
Returns a single directory with its children and materials.

### `GET /api/directories/{id}/path`
Returns the full path from root to the given directory as an array of `{id, name, slug}` objects. Used for breadcrumb navigation.

## Directory Service (`api/app/services/directory.py`)

### `slugify(text)`
Converts display names to URL-safe slugs:
- Lowercases
- Replaces spaces and special characters with hyphens
- Collapses multiple hyphens
- Strips leading/trailing hyphens

### `get_directory_path(db, directory_id)`
Walks up the directory tree via `parent_id` to build the full path from root. Returns an ordered list of `{id, name, slug}` dicts.

**Edge case:** Circular reference detection — the function tracks visited IDs and breaks the loop if it encounters a cycle (defensive against data corruption).

## Materials Router (`api/app/routers/materials.py`)

### `GET /api/materials/{id}`
Returns material detail with current version info.

### `GET /api/materials/{id}/versions`
Lists all versions of a material, ordered by version number.

### `GET /api/materials/{id}/download`
Generates a presigned download URL for the latest version.

### `GET /api/materials/{id}/versions/{version_number}/download`
Download a specific version.

### `GET /api/materials/{id}/text-content`
Returns the raw UTF-8 text of the material's current version. Works for both plain-text files and gzip-compressed text files (`.gz`). Only available for text-based materials.

### `POST /api/materials/{id}/text-content`
Accepts raw UTF-8 text in the request body, gzip-compresses it server-side, and stores it in object storage. Creates a clean `Upload` row and returns a `file_key` ready to be staged in an `edit_material` pull request operation.

## Search Router (`api/app/routers/search.py`)

### `GET /api/search`
Full-text search across materials and directories via MeiliSearch.

**Query parameters:** `q` (search text), `type` (material type filter), `limit`, `offset`

The search service queries MeiliSearch and enriches results with browse paths for navigation.

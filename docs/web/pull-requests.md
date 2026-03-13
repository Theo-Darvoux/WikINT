# Pull Requests (Frontend)

The PR frontend consists of a staging cart system for building batch operations, an upload system, and pages for listing/reviewing PRs. Users stage changes while browsing, then submit them as a PR.

**Key files**: `web/src/lib/staging-store.ts`, `web/src/components/pr/`, `web/src/hooks/use-upload.ts`, `web/src/app/pull-requests/`

---

## Staging Cart

The `useStagingStore` (`web/src/lib/staging-store.ts`) is a Zustand store persisted to `localStorage["wikint-staging-cart"]`. It accumulates operations as users interact with the browse interface.

### Operation Types
Each staged operation wraps a PR operation with a `stagedAt` timestamp:

| Operation | Created By |
|-----------|-----------|
| `create_material` | UploadDrawer (file upload) |
| `edit_material` | EditItemDialog or ActionsTab |
| `delete_material` | ActionsTab |
| `create_directory` | NewFolderDialog |
| `edit_directory` | EditItemDialog |
| `delete_directory` | ActionsTab |
| `move_item` | Selection mode cut/paste |

### Temp ID System
`nextTempId(prefix)` generates IDs like `$dir-1`, `$mat-2`. These allow operations to reference each other (e.g., create a folder, then upload a file into it).

### Upload Expiry
Files uploaded to MinIO are cleaned up after 24 hours by the server. The staging store tracks this:
- `UPLOAD_EXPIRY_MS`: 24 hours
- `UPLOAD_WARNING_MS`: 2 hours before expiry
- `isExpired(staged)` / `isExpiringSoon(staged)` — check functions
- `purgeExpired()` — removes expired operations, returns count

### Cascade Deletion
`removeOperation(index)` cascades when removing:
- A `create_directory` with a `temp_id`: also removes all `create_material` and nested `create_directory` operations that reference it, and any `move_item` targeting it
- A `create_material` with a `temp_id`: removes child attachment operations

---

## UI Components

### CartFab (`cart-fab.tsx`)
Fixed bottom-right button that appears when operations are staged. Shows:
- Operation count badge
- Warning icon if any uploads are expired
- Clicking opens the ReviewDrawer

### ReviewDrawer (`review-drawer.tsx`)
A right-sliding sheet panel for reviewing and submitting staged operations:
- **Title and description** fields for the PR
- **Operation cards** — expandable, showing operation details with edit capabilities
- **Attachment management** for materials
- **Tag editing** via chip input
- **Expiry warnings** for operations with expiring uploads
- **Submit** → `POST /api/pull-requests` with all staged operations
- **Discard** → clears all staged operations

### UploadDrawer (`upload-drawer.tsx`)
Complex file upload interface:
- Drag-and-drop support with visual feedback
- Folder picker (`webkitdirectory`) — traverses folder structure and creates directory operations before material operations
- Multiple file support with concurrent uploads (max 4 simultaneous)
- Per-file progress tracking and status indicators
- Supports `initialFiles` prop for pre-loading files from GlobalDropZone

### GlobalDropZone (`global-drop-zone.tsx`)
Full-screen drag-and-drop overlay. Detects file drags anywhere on the document, shows an animated upload icon, resolves the target directory from the current browse context, and passes files to UploadDrawer.

### PRFileUpload (`pr-file-upload.tsx`)
Single file upload with status tracking: idle → uploading → scanning → success/error. Shows progress bar during upload and scanning phases.

### NewFolderDialog (`new-folder-dialog.tsx`)
Modal dialog for creating a folder. Fields: name, description. Stages a `create_directory` operation.

### EditItemDialog (`edit-item-dialog.tsx`)
Modal for editing materials (title, description, tags) or directories (name, description). Only stages if changes detected.

---

## useUpload Hook

`web/src/hooks/use-upload.ts` manages the three-phase upload:

1. `POST /api/upload/request-url` → get `upload_url` and `file_key`
2. `PUT upload_url` (XHR with progress tracking, 10-90% range)
3. `POST /api/upload/complete` → virus scan, final metadata

Returns: `{ uploading, progress, error, fileKey, upload, reset }`

---

## PR Pages

### PR List (`/pull-requests`)
`web/src/components/pr/pr-list.tsx`:
- Tab bar: Open, Merged, Rejected, All (with counts)
- 20 PRs per page with pagination
- Each PR rendered as a `PRCard`

### PR Card (`pr-card.tsx`)
Compact display: status icon (color-coded), title, operation type badges, vote score pill, author avatar.

### PR Detail (`/pull-requests/[id]`)
`web/src/app/pull-requests/[id]/page.tsx`:
- Operation summary with type counts and badges
- Expandable operation rows with file preview support
- **PRVoteButtons** — up/down arrows with score display, auto-approve callback at score >= 5
- **PRComments** — threaded discussion section
- Approve/Reject buttons for moderators
- Author cannot vote on own PR

### PRDiffView (`pr-diff-view.tsx`)
Shows changed properties in a two-column layout and provides file preview download.

# Frontend Overview (`web/`)

## Tech Stack

| Technology | Purpose |
|-----------|---------|
| Next.js 15 (App Router) | Framework, SSR, routing |
| React 19 | UI library |
| TypeScript | Type safety |
| Tailwind CSS | Styling |
| Zustand | Client-side state management |
| shadcn/ui | UI component library |

## App Router Structure

```
web/src/app/
├── layout.tsx                      # Root layout (providers, navbar, footer)
├── page.tsx                        # Landing page
├── login/
│   ├── page.tsx                    # Email input for OTP
│   └── verify/page.tsx             # OTP code entry + magic link handler
├── onboarding/page.tsx             # First-time user setup
├── browse/[[...path]]/page.tsx     # Main content browser (catch-all route)
├── pull-requests/
│   ├── page.tsx                    # PR list
│   ├── new/page.tsx                # PR creation wizard
│   └── [id]/page.tsx               # PR detail/review
├── profile/
│   ├── page.tsx                    # Current user profile
│   └── [id]/page.tsx               # Other user profile
├── notifications/page.tsx          # Notification center
├── settings/page.tsx               # User settings
├── privacy/page.tsx                # Privacy policy
└── admin/
    ├── layout.tsx                  # Admin layout (role guard)
    ├── page.tsx                    # Admin dashboard
    ├── users/page.tsx              # User management
    ├── directories/page.tsx        # Directory management
    ├── pull-requests/page.tsx      # PR moderation
    └── flags/page.tsx              # Content moderation flags
```

### Key Route: Browse (`/browse/[[...path]]`)

The `[[...path]]` catch-all segment captures the full slug path (e.g., `/browse/math/linear-algebra/chapter-1`). The page:
1. Calls `GET /api/browse/{path}` with the joined slug segments
2. Renders either a `DirectoryListing` or `MaterialViewer` based on the response type
3. Shows breadcrumbs for navigation

## Component Architecture

### Layout Components
- `LayoutShell` — Main app shell with responsive sidebar
- `Navbar` — Top navigation with search, notifications, user menu
- `MobileBottomBar` — Bottom navigation for mobile
- `Footer` — Site footer
- `AuthGuard` — Wraps authenticated pages, redirects to login if not authenticated
- `CookieBanner` — GDPR cookie consent

### Browse Components
- `DirectoryListing` — Renders a directory's children (folders + materials)
- `DirectoryLineItem` — Single directory row
- `MaterialLineItem` — Single material row with type icon and metadata
- `MaterialViewer` — Container that selects the appropriate viewer component
- `Breadcrumbs` — Slug-path based breadcrumb navigation
- `DirectoryOpenPRs` — Shows pending PRs affecting this directory
- `EmptyDirectory` — Empty state with upload CTA

### Viewer Components (`components/viewers/`)
Each viewer handles a specific file type:
- `PDFViewer` — PDF rendering (pdf.js based)
- `ImageViewer` — Image display with zoom
- `VideoPlayer` — HTML5 video player
- `AudioPlayer` — HTML5 audio player
- `CodeViewer` — Syntax-highlighted code (highlight.js or similar)
- `MarkdownViewer` — Rendered markdown (with GFM, WikiLinks, Mermaid diagrams, and Obsidian callouts)
- `EpubViewer` — EPUB reader
- `DjvuViewer` — DjVu document viewer
- `OfficeViewer` — OnlyOffice integration for docx/xlsx/pptx
- `GenericViewer` — Fallback download-only view
- `FullscreenToggle` — Fullscreen mode control

### PR Components (`components/pr/`)
- `PRList` — Paginated PR list with status filtering
- `PRCard` — Individual PR summary card
- `PRCreateWizard` — Multi-step PR creation flow
- `PRFileUpload` — File upload within PR context
- `PRDiffView` — Visual diff of PR operations
- `PRVoteButtons` — Upvote/downvote controls
- `PRComments` — Threaded comment display
- `ReviewDrawer` — Side panel showing staged operations
- `UploadDrawer` — File upload progress panel
- `StagingFAB` — Floating action button showing staged operation count
- `EditItemDialog` — Edit material/directory metadata
- `NewFolderDialog` — Create directory inline
- `FilePreview` — Preview of uploaded file before submission
- `GlobalDropZone` — Drag-and-drop file upload anywhere on the page

### Sidebar Components (`components/sidebar/`)
- `SharedSidebar` — Sidebar framework with tab navigation
- `DetailsTab` — Material metadata display
- `AnnotationsTab` — Document annotations
- `EditsTab` — Version history
- `ActionsTab` — Download, flag, share actions
- `ChatTab` — Comments/discussion
- `FloatingPanel` / `GlobalFloatingSidebar` — Detachable sidebar

### Profile Components
- `ProfileView` — User profile display
- `ContributionList` — User's PRs and contributions
- `RecentlyViewed` — View history
- `ReputationBadge` — Visual reputation indicator

## State Management

### Zustand Stores

**`staging-store.ts`** — The most important client-side store. Persists staged PR operations to `localStorage`:
- `operations: StagedOperation[]` — Pending PR operations with timestamps
- `uploads: StagedUpload[]` — In-progress file uploads
- `reviewOpen: boolean` — Whether the review drawer is open
- Methods: `addOperation`, `removeOperation`, `updateOperation`, `clearOperations`, `purgeExpired`

Operations have a 24-hour expiry (matching the server-side upload cleanup). The store tracks `stagedAt` timestamps and provides helpers (`isExpired`, `isExpiringSoon`, `msUntilExpiry`) for the UI to show warnings.

**`stores.ts`** — Additional Zustand stores for UI state (sidebar visibility, viewer preferences)

**`selection-store.ts`** — Text selection state for the annotation system

### Auth State (`lib/auth-tokens.ts`, `hooks/use-auth.ts`)
- JWT access token stored in memory (not localStorage for security)
- Token refresh handled transparently by the API client
- `useAuth()` hook provides `user`, `login`, `logout`, `isAuthenticated`

## API Client (`lib/api-client.ts`)

Centralized fetch wrapper:
- Base URL configuration
- Automatic `Authorization: Bearer <token>` header injection
- Automatic token refresh on 401 responses
- Typed error handling (`ApiError` class)
- Request/response JSON serialization

## Upload Client (`lib/upload-client.ts`)

Handles the three-phase upload flow:
1. `POST /api/upload` with the file (streaming)
2. Open SSE connection to track processing progress
3. Return the final `file_key` and metadata

Supports progress callbacks (`onProgress`, `onStatusUpdate`) and `AbortController` for cancellation.

## Crypto Utils (`lib/crypto-utils.ts`)

Client-side SHA-256 hashing using the Web Crypto API. Used for:
- CAS deduplication checks (hash file before uploading to check if it already exists)
- Upload integrity verification

## File Utils (`lib/file-utils.ts`)

Utilities for file type detection, size formatting, icon selection, and extension validation. Mirrors the server-side MIME type registry so the UI can validate files before attempting upload.

## Upload Queue (`lib/upload-queue.ts`)

Manages multiple concurrent file uploads with:
- Queue size limits
- Retry logic
- Progress aggregation across multiple files
- Error isolation (one failed upload doesn't affect others)

## SSE Client (`lib/sse-client.ts`)

Wrapper around `EventSource` for upload progress streaming:
- Automatic reconnection with backoff
- Token-based authentication via query parameter
- Event parsing and type-safe callback dispatch
- Timeout handling

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
├── page.tsx                        # Home page (featured, popular, PRs, favourites)
├── popular/
│   └── page.tsx                    # "See all popular" with period tabs + pagination
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
    ├── layout.tsx                  # Admin layout (role guard) — includes Featured tab
    ├── page.tsx                    # Admin dashboard
    ├── users/page.tsx              # User management
    ├── directories/page.tsx        # Directory management
    ├── pull-requests/page.tsx      # PR moderation
    ├── flags/page.tsx              # Content moderation flags
    └── featured/page.tsx           # Featured items management (home page curation)
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
- `MobileBottomBar` — Bottom navigation for mobile (Home / Notifications / Profile with active-state highlighting via `usePathname`)
- `Footer` — Site footer
- `AuthGuard` — Wraps authenticated pages, redirects to login if not authenticated
- `CookieBanner` — GDPR cookie consent

### Home Components (`components/home/`)

These components power the home page, the `/popular` page, and the admin featured management page.

#### Shared foundations
- `types.ts` — TypeScript interfaces shared across home components: `MaterialDetail`, `MaterialVersionInfo`, `FeaturedItem`, `PullRequestOut`, `HomeData`
- `file-type-display.tsx` — Pure utilities:
  - `getFileTypeStyle(fileName, mimeType)` — Returns `{ gradient, iconColorClass, Icon }` for Tailwind gradient backgrounds and Lucide icons keyed by file extension / MIME type. Covers PDF, images, video, audio, code, documents, spreadsheets, presentations, markdown, and e-books.
  - `getMaterialBrowsePath(material)` — Constructs `/browse/{directory_path}/{slug}` or `/browse/{slug}`.

#### Display components
- `SectionHeader` — Reusable section heading with optional subtitle and "See all →" link. Props: `title`, `subtitle?`, `seeAllHref?`, `seeAllLabel?`.
- `MaterialCard` — Card component for a single `MaterialDetail`. Fixed `w-[220px]` (overridable via `className` for grid layouts). Shows a 4:3 gradient preview area with file-type icon, file-type badge, title, filename, file size, directory path, view count, and like count. Hover lifts the card.
- `FeaturedSection` — Renders admin-curated featured materials. Empty array → renders nothing. Single item → full-width split hero card with gradient panel + content area. Multiple items → horizontally-scrollable row of `FeaturedScrollCard` components (300 px wide each). Each card shows gradient banner, "Featured" pill, title, description, tags, and a "View material" CTA.
- `PopularSection` — Horizontally-scrollable row of up to 8 `MaterialCard`s with a "See all" dashed card appended when `materials.length >= 8`. Supports an `isLoading` skeleton state (4 placeholder cards).
- `FavouritesSection` — Identical layout to `PopularSection` for the user's recently favourited materials. "See all" links to `/profile`. Hidden when empty.
- `RecentPRsSection` — Compact list card of open pull requests. Each row shows: status icon, title, author, time-ago, "Open" badge, and vote score pill. Hidden when empty. Supports `isLoading` skeleton rows.

#### Data flow — Home page (`app/page.tsx`)
1. Fetches `GET /api/home` on mount → populates `HomeData`.
2. Renders in order: welcome greeting (`Good morning/afternoon/evening, {name}!`), `FeaturedSection`, `PopularSection` (today), `PopularSection` (14 d), `RecentPRsSection`, `FavouritesSection`.
3. Loading state: skeleton placeholders for each section.
4. Error state: inline destructive banner.

#### Data flow — Popular page (`app/popular/page.tsx`)
- Uses `useSearchParams` (wrapped in `<Suspense>`) to read the `period` query param (`"today"` | `"14d"`).
- Tab switcher updates the URL via `router.replace` without a full navigation.
- Fetches `GET /api/home/popular?period={period}&limit=20&offset={offset}`.
- Renders a responsive grid: 2 cols (mobile) → 3 cols (sm) → 4 cols (md) → 5 cols (lg).
- "Load more" button appends the next page; a summary line is shown once all results are loaded.

#### Admin — Featured management (`app/admin/featured/page.tsx`)
- Lists all featured items from `GET /api/admin/featured`.
- Sorts by status (active → scheduled → expired) then by priority descending.
- **Add Featured dialog**: collects Material UUID, optional title/description overrides, `start_at`/`end_at` datetime inputs, and priority. Validates date ordering before submitting `POST /api/admin/featured`.
- **Delete**: confirmation dialog → `DELETE /api/admin/featured/{id}`.
- Status badges: animated green "Active" pill, blue "Scheduled", gray "Expired".
- Summary line at the bottom shows counts per status.
- Accessible via the **Featured** tab in the admin layout nav (Star icon).

### Browse Components
- `DirectoryListing` — Renders a directory's children (folders + materials)
- `DirectoryLineItem` — Single directory row
- `MaterialLineItem` — Single material row with type icon and metadata
- `MaterialViewer` — Container that selects the appropriate viewer component. It hides the main page scrollbar and footer while active to provide a focused viewing experience.
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
- `OperationRow` — Individual change row in the PR detail view, showing metadata changes and file diffs. Uses `ExpandableText` for descriptions.

### Sidebar Components (`components/sidebar/`)
- `SharedSidebar` — Sidebar framework with tab navigation. On desktop it renders `SidebarContent` directly inside the page's bounded container. On mobile it uses a custom Sheet built from Radix `Dialog` primitives (`SheetPortal` + `SheetOverlay` + `SheetPrimitive.Content`) with slide-in-from-right animation — no separate `FloatingPanel` or `GlobalFloatingSidebar` needed.
- `DetailsTab` — Material metadata display
- `AnnotationsTab` — Document annotations
- `EditsTab` — Version history
- `ActionsTab` — Download, flag, share actions
- `ChatTab` — Comments/discussion

#### Layout fix: `absolute inset-0` on `TabsContent`
Radix `ScrollAreaViewport` only activates `overflow-y: scroll` once a `ResizeObserver` fires and detects `offsetHeight < scrollHeight`. When the viewport has no concrete CSS height (only flex/percentage chains), `offsetHeight` always equals `scrollHeight` and scrolling never activates. The fix is to give each `TabsContent` panel `position: absolute; inset: 0` inside a `relative flex-1 min-h-0` container — this provides a concrete, positioned height without relying on CSS percentage resolution through flex chains. Scroll-heavy tabs (`details`, `edits`) use `overflow-y-auto` directly on the `TabsContent`; flex-column tabs (`chat`, `annotations`, `actions`) use `flex flex-col`.

### Profile Components
- `ProfileView` — User profile display
- `ContributionList` — User's PRs and contributions
- `RecentlyViewed` — View history
- `ReputationBadge` — Visual reputation indicator

### Generic UI Components (`components/ui/`)
- `ExpandableText` — Text component that clamps to a specific number of lines with a "Show more" toggle. Uses `overflow-wrap: anywhere` to handle long strings without spaces.
- `TagInput` — Interactive tag selection and management component.
- `ConfirmDeleteDialog` — Standardized confirmation dialog for destructive actions.
- `Badge`, `Button`, `Dialog`, `Accordion`, etc. — Standardized shadcn/ui primitives.

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

## Print System (`lib/print-utils.ts`, `hooks/use-print.ts`)

The print system lets viewers send a formatted document to the browser's print dialog via a hidden iframe.

### Architecture

- **`isPrintable(viewerType)`** — returns true for `pdf`, `image`, `code`, `markdown`, `office`
- **`printInIframe(content, options)`** — creates a hidden `<iframe>`, writes HTML (or loads a blob URL for PDFs), calls `window.print()`, then removes the iframe
- **`usePrint({ viewerType, materialId, fileName, mimeType })`** — React hook that assembles the printable content per viewer type and drives the flow

### Per-viewer print strategies

| Viewer | Strategy |
|--------|----------|
| `pdf` | Fetch blob → create blob URL → load directly in iframe |
| `image` | Fetch blob → `<img>` centered in iframe |
| `code` | Fetch raw text → HTML-escape → `<pre><code>` in iframe |
| `markdown` | Capture rendered DOM HTML via registry → inject into iframe with prose + hljs CSS |
| `office` | Delegate to OnlyOffice's built-in print via `office-print-registry` |

### Markdown print registry (`lib/markdown-print-registry.ts`)

`MarkdownViewer` registers a getter on mount (keyed by `materialId`) that returns the `innerHTML` of its rendered prose container. `usePrint` calls this registry to obtain already-rendered HTML instead of re-processing the raw markdown source. This ensures the printed output exactly matches what the user sees, including syntax highlighting, callouts, tables, and Mermaid diagrams.

```
registerMarkdownPrint(materialId, () => proseRef.current?.innerHTML)  // in MarkdownViewer
getMarkdownContent(materialId)                                         // in usePrint
```

## SSE Client (`lib/sse-client.ts`)

Wrapper around `EventSource` for upload progress streaming:
- Automatic reconnection with backoff
- Token-based authentication via query parameter
- Event parsing and type-safe callback dispatch
- Timeout handling

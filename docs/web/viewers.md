# Document Viewers

WikINT supports in-browser viewing of many document types. The appropriate viewer is selected based on the material's MIME type. All viewers fetch content from the API and handle loading/error states.

**Key directory**: `web/src/components/viewers/`

---

## Viewer Selection

The browse page selects a viewer based on `file_mime_type` from the material's current version:

| MIME Type | Viewer Component |
|-----------|-----------------|
| `application/pdf` | react-pdf (Document/Page) |
| `image/*` | `ImageViewer` |
| `video/*` | `VideoPlayer` |
| `audio/*` | `AudioPlayer` |
| `text/markdown` | `MarkdownViewer` |
| `application/epub+zip` | `EpubViewer` |
| `image/vnd.djvu` | `DjvuViewer` |
| `application/vnd.openxmlformats-officedocument.*` | `OfficeViewer` |
| `application/vnd.ms-*` | `OfficeViewer` |
| `text/*`, source code extensions | `CodeViewer` |
| Everything else | `GenericViewer` |

---

## Viewer Components

### PDF Viewer
Uses `react-pdf` 9.2+ with `Document` and `Page` components. Console patches suppress `AbortException` and `InvalidPDFException` messages from PDF.js that would otherwise spam the Next.js Turbopack dev overlay. Includes an `onLoadError` handler on the `<Document>` component and an error state so parse failures display a message to the user instead of silently failing.

### ImageViewer (`image-viewer.tsx`)
Fetches the image as a blob via the API, creates an object URL with `URL.createObjectURL()`, and displays it centered with max constraints. Revokes the blob URL on unmount to prevent memory leaks.

### VideoPlayer (`video-player.tsx`)
Two modes:
- **Embedded**: If `material.metadata.video_url` exists, renders an `<iframe>`
- **Self-hosted**: Fetches video blob, renders with native `<video>` controls and `playsInline` for mobile

### AudioPlayer (`audio-player.tsx`)
A high-quality audio player featuring:
- **Waveform Visualization**: Generates a professional bar-based waveform (SoundCloud style) using the Web Audio API to decode the file on the client side.
- **Dynamic Theming**: Responsive design that adjusts contrast and colors for both light and dark modes.
- **Advanced Controls**: Includes playback speed adjustments (0.5x to 2x), volume management, skip controls, and time seeking via the interactive waveform.
- **Lazy Fetching**: Only fetches and decodes the audio file when the viewer is mounted. Uses a short-lived blob URL for the underlying `<audio>` element.

### MarkdownViewer (`markdown-viewer.tsx`)
Full-featured markdown renderer using `react-markdown` with GFM support. Fetches content via `fetchMaterialFile()`.

- **Plugins**: `remark-gfm` (tables, task lists, strikethrough, autolinks), `rehype-raw` (inline HTML passthrough), `rehype-sanitize` (XSS-safe HTML allowlist based on GitHub's schema), `rehype-highlight` (syntax-highlighted code blocks via highlight.js)
- **Inline images**: `<img>` tags render with lazy loading, rounded corners, and `max-w-full` for responsive sizing
- **Tables**: Wrapped in `overflow-x-auto` for horizontal scrolling on narrow viewports
- **Links**: External links open in a new tab with `rel="noopener noreferrer"`
- **Theming**: Uses `@tailwindcss/typography` prose classes with `dark:prose-invert` and custom hljs dark overrides in `globals.css`
- **Performance**: Rendered output is memoized with `useMemo` to avoid re-parsing on re-renders

### OfficeViewer (`office-viewer.tsx`)
Fetches file via `apiRequest()` (same centralized auth as other viewers). Dynamic imports for format-specific libraries:
- **DOCX**: `mammoth` converts to HTML, rendered via `dangerouslySetInnerHTML`
- **Excel**: `xlsx` parses spreadsheet, converts to HTML table
- Unsupported Office formats show a graceful fallback message

### CodeViewer (`code-viewer.tsx`)
Uses `highlight.js` with a mapping of 65+ file extensions to language identifiers. Includes custom LaTeX language support. Theme: `github.css`. Fetches source text via `apiRequest()`. Renders in a scrollable `<pre><code>` block with syntax highlighting.

### EpubViewer (`epub-viewer.tsx`)
Fetches file via `apiRequest()`, then loads `epub.js` from CDN on demand. Creates an epub instance, renders into an 800px-height container. Manages lifecycle with `isMounted` flag, destroys book on unmount.

### DjvuViewer (`djvu-viewer.tsx`)
Placeholder — DjVu rendering requires WebAssembly support not currently installed. Shows an explanatory message with a download button that uses the `useDownload` hook.

### GenericViewer (`generic-viewer.tsx`)
Fallback for unsupported types. Displays file name, MIME type, formatted size, and a download button. Uses the `useDownload` hook — clicking opens a new tab and navigates it to the presigned URL returned by `/download-url`.

---

## Common Patterns

All viewers follow similar patterns:
- **Fetch on mount**: Use `useEffect` with `materialId` dependency
- **Centralized auth**: All viewers fetch file content through the API client (`api-client.ts`) rather than manually attaching tokens. Binary viewers (PDF, image, video, audio) use `apiFetchBlob()`, while text-based viewers (markdown, code) and format-specific viewers (office, epub) use `apiRequest()` to access the raw `Response`. Both helpers handle Bearer token injection and automatic 401 token refresh.
- **Loading state**: Show skeleton or spinner while fetching
- **Blob management**: Create and revoke object URLs for binary content
- **Cleanup**: Revoke URLs and destroy resources on unmount
- **Error handling**: Display error message with download fallback

---

## useDownload Hook

`web/src/hooks/use-download.ts`

Used by `GenericViewer`, `DjvuViewer`, `MaterialViewer` header, `ViewerFab`, and `ActionsTab` to initiate file downloads without navigating away from the app:

1. Opens a blank tab synchronously (in the user-gesture context, before any async work) so popup blockers don't interfere.
2. Fetches `GET /materials/{id}/download-url` (or `/versions/{n}/download-url` for historical versions) via `apiFetch`.
3. Navigates the opened tab to the returned presigned URL.
4. On error: closes the blank tab and shows a toast.

The blank-tab-first approach is required because browsers only allow `window.open` during a synchronous user gesture; awaiting the fetch first would cause the popup to be blocked.

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
Uses `react-pdf` 9.2+ with `Document` and `Page` components. The `mute-pdf-warnings.ts` utility patches `console.error/warn` to suppress `AbortException` messages from PDF.js TextLayer task cancellations.

### ImageViewer (`image-viewer.tsx`)
Fetches the image as a blob via the API, creates an object URL with `URL.createObjectURL()`, and displays it centered with max constraints. Revokes the blob URL on unmount to prevent memory leaks.

### VideoPlayer (`video-player.tsx`)
Two modes:
- **Embedded**: If `material.metadata.video_url` exists, renders an `<iframe>`
- **Self-hosted**: Fetches video blob, renders with native `<video>` controls and `playsInline` for mobile

### MarkdownViewer (`markdown-viewer.tsx`)
Fetches file content as text, renders in a `<pre>` tag with prose styling. Plain text display (no markdown rendering).

### OfficeViewer (`office-viewer.tsx`)
Dynamic imports for format-specific libraries:
- **DOCX**: `mammoth` converts to HTML, rendered via `dangerouslySetInnerHTML`
- **Excel**: `xlsx` parses spreadsheet, converts to HTML table
- Unsupported Office formats show a graceful fallback message

### CodeViewer (`code-viewer.tsx`)
Uses `highlight.js` with a mapping of 65+ file extensions to language identifiers. Includes custom LaTeX language support. Theme: `github.css`. Renders in a scrollable `<pre><code>` block with syntax highlighting.

### EpubViewer (`epub-viewer.tsx`)
Loads `epub.js` from CDN on demand. Creates an epub instance, renders into an 800px-height container. Manages lifecycle with `isMounted` flag, destroys book on unmount.

### DjvuViewer (`djvu-viewer.tsx`)
Placeholder — DjVu rendering requires WebAssembly support not currently installed. Shows an explanatory message with a download button.

### GenericViewer (`generic-viewer.tsx`)
Fallback for unsupported types. Displays file name, MIME type, formatted size, and a download button.

---

## Common Patterns

All viewers follow similar patterns:
- **Fetch on mount**: Use `useEffect` with the `fileKey` or `materialId` dependency
- **Loading state**: Show skeleton or spinner while fetching
- **Blob management**: Create and revoke object URLs for binary content
- **Cleanup**: Revoke URLs and destroy resources on unmount
- **Error handling**: Display error message with download fallback

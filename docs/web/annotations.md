# Annotations (Frontend)

The annotation system lets users highlight text in documents and start threaded discussions. Annotations update in real-time via Server-Sent Events.

**Key files**: `web/src/hooks/use-annotations.ts`, `web/src/lib/sse-client.ts`, `web/src/components/browse/material-viewer.tsx`, `web/src/components/annotations/annotation-selection-tooltip.tsx`, `web/src/components/annotations/annotation-thread.tsx`, `web/src/components/sidebar/annotations-tab.tsx`

---

## Data Flow

```mermaid
sequenceDiagram
    participant U as User
    participant V as Viewer Component
    participant T as SelectionTooltip
    participant H as useAnnotations Hook
    participant A as API
    participant SSE as EventSource

    U->>V: Select text in document
    V->>T: Mouse up event → show tooltip
    U->>T: Click "Annotate", type comment
    T->>H: createAnnotation(body, selectionText, positionData, page)
    H->>A: POST /materials/{id}/annotations
    A-->>SSE: broadcast annotation_created
    SSE-->>H: event: annotation_created
    H->>H: Refresh thread list
```

---

## useAnnotations Hook

`web/src/hooks/use-annotations.ts` manages annotation state for a material:

**State**: `threads`, `loading`, `page`, `pages`, `total`

**Methods**:
| Method | API Call |
|--------|----------|
| `fetchAnnotations(page)` | `GET /materials/{id}/annotations?page=&limit=20` |
| `createAnnotation(body, selectionText?, positionData?, docPage?, replyToId?)` | `POST /materials/{id}/annotations` |
| `editAnnotation(id, body)` | `PATCH /annotations/{id}` |
| `deleteAnnotation(id)` | `DELETE /annotations/{id}` |

**Real-time**: Uses `createSSEConnection` from `web/src/lib/sse-client.ts` to connect to `GET /materials/{id}/sse`. Listens for:
- `annotation_created` → refreshes thread list
- `annotation_deleted` → refreshes thread list

The shared `createSSEConnection` utility handles auto-reconnection (5s delay) and cleanup. A 50ms `startupDelay` is used to survive React Strict Mode's double-mount in development.

---

## AnnotationSelectionTooltip

`web/src/components/annotations/annotation-selection-tooltip.tsx`

Appears when the user selects text in the document viewer:

1. **Mouse up** event handler checks for text selection within the container
2. If text is selected, shows a small button near the selection
3. Clicking expands into a textarea form
4. Captures: selected text, page number (from `data-page-number` attribute on the DOM element), position data (offsets)
5. On submit, calls the `onSubmit` callback with annotation data

Positioned absolutely near the selection. Dismissed on click outside.

---

## AnnotationThread

`web/src/components/annotations/annotation-thread.tsx`

Displays a single thread (root + replies):

- **Root annotation**: Shows highlighted `selection_text` with a left border, author info, body, timestamps
- **Replies**: Indented with a left border, showing author and body
- **Actions per annotation**:
  - Edit (if current user is author)
  - Delete (if author or moderator)
  - Reply (expands reply form)
  - Flag (if not author)

Also exports `AnnotationForm` — a textarea component used for composing new annotations and replies.

---

## AnnotationsTab

`web/src/components/sidebar/annotations-tab.tsx`

Sidebar tab (desktop only — hidden on mobile) that shows all annotation threads for the current material:

- Thread cards with pagination
- Reply and edit forms inline
- Empty state shows help text explaining how to create annotations
- Consumes `AnnotationsContext` (see below) — does **not** open its own SSE connection

---

## AnnotationsContext

`web/src/hooks/use-annotations.ts` also exports:

```ts
export type AnnotationsAPI = ReturnType<typeof useAnnotations>;
export const AnnotationsContext = createContext<AnnotationsAPI | null>(null);
export function useAnnotationsContext(): AnnotationsAPI | null
```

`MaterialViewer` calls `useAnnotations(materialId)` once and wraps its JSX in `<AnnotationsContext.Provider value={annotationsData}>`. `AnnotationsTab` consumes this context via `useAnnotationsContext()` instead of calling `useAnnotations` itself.

**Why this matters**: Without the context, both `MaterialViewer` and `AnnotationsTab` would each open an independent SSE connection to `/api/materials/{id}/sse`. Radix UI's `TabsContent` unmounts inactive tabs, so switching away from the Annotations tab would tear down its SSE and trigger a CORS false positive on remount. The context approach keeps exactly one SSE connection for the entire viewer lifetime.

The `useAnnotations` SSE connection uses `createSSEConnection` with a 50ms `startupDelay` to survive React Strict Mode's double-mount (which would otherwise cause a CORS error on first render in development).

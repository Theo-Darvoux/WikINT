# Markdown and Diagram Rendering Security

## Overview

WikINT uses `react-markdown` to render documentation and material content. Because markdown can include raw HTML, embedded diagrams, and external images, several layers of security are implemented to prevent Cross-Site Scripting (XSS) and client-side Denial of Service (DoS) attacks.

## Security Layers

### 1. HTML Sanitization (`rehype-sanitize`)

All markdown content passes through `rehype-sanitize` before being rendered. 
- **Purpose**: Prevents the execution of malicious `<script>` tags, event handlers (`onclick`, etc.), and dangerous HTML elements.
- **Schema**: We use a modified version of the GitHub default schema.
- **Highlights**: 
    - `className` is allowed on `code` and `span` tags specifically to support syntax highlighting.
    - `src` on `img` tags is restricted to safe protocols (`http`, `https`, `data`).

### 2. Mermaid Diagram Hardening

Mermaid diagrams are processed by a dedicated component (`Mermaid.tsx`).

- **Security Level**: Set to `strict`. This is critical as it prevents Mermaid from parsing HTML within diagram labels and disables interactive features like `click` callbacks which could be used for XSS.
- **HTML Labels**: Explicitly disabled (`htmlLabels: false`).
- **Character Limit**: Diagram source is capped at **50,000 characters**. This prevents a "Mermaid Bomb" attack where an extremely massive or complex diagram source hangs the browser's main thread during the layout process.

### 3. SVG Image Handling

- **Mode**: SVGs are rendered via standard HTML `<img>` tags.
- **Isolation**: Browsers automatically sandbox SVGs loaded via `img` tags, preventing any embedded `<script>` tags from executing in the context of our application.
- **Server-side check**: SVGs also undergo a server-side safety check via `defusedxml` during the upload phase to strip external entities.

### 4. Recursive Rendering Protection

Recursive functions used to extract text or process the React tree (like `getTextFromChildren`) have a strict **depth limit** (e.g., 10 levels). This prevents stack overflow errors if a malicious React structure is encountered.

## Best Practices for Developers

- **Never** use `dangerouslySetInnerHTML` for user-provided markdown content without passing it through the `MarkdownViewer` component.
- **Avoid** modifying the `sanitizeSchema` unless absolutely necessary for a new content type, and always err on the side of restriction.
- **Keep** `securityLevel: "strict"` for Mermaid unless a specific, trusted use case requires "loose" features, in which case a secondary sanitization layer (like `DOMPurify`) **must** be added.

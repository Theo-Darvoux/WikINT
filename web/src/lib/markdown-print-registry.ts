/**
 * Registry that lets the print system capture the already-rendered HTML
 * from the active MarkdownViewer instead of re-processing raw markdown.
 *
 * MarkdownViewer registers a getter on mount (keyed by materialId) that
 * returns the innerHTML of its rendered prose container, and usePrint
 * calls it when viewerType === "markdown".
 */

const registry = new Map<string, () => string | null>();

export function registerMarkdownPrint(materialId: string, fn: () => string | null) {
  registry.set(materialId, fn);
}

export function unregisterMarkdownPrint(materialId: string) {
  registry.delete(materialId);
}

export function getMarkdownContent(materialId: string): string | null {
  return registry.get(materialId)?.() ?? null;
}

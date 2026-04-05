/**
 * Module-level registry that lets the sidebar/FAB print button
 * trigger OnlyOffice's built-in print for the currently open document.
 *
 * OfficeViewer registers a print callback on mount (keyed by materialId)
 * and usePrint looks it up when viewerType === "office".
 */

const registry = new Map<string, () => void>();

export function registerOfficePrint(materialId: string, fn: () => void) {
  registry.set(materialId, fn);
}

export function unregisterOfficePrint(materialId: string) {
  registry.delete(materialId);
}

export function getOfficePrint(materialId: string): (() => void) | undefined {
  return registry.get(materialId);
}

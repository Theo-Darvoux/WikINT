import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Strip characters not allowed in name/title fields.
 * Keeps printable ASCII plus precomposed Latin accented characters
 * (U+00C0–U+017F) used in French and other Western European languages.
 * Blocks Zalgo text, emoji, Arabic, CJK, and other non-Latin scripts.
 */
export function sanitizeNameInput(v: string): string {
  return v.replace(/[^\x20-\x7e\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u017f]/g, "");
}

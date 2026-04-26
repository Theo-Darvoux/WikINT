"use client";

import { useLocaleContext } from "@/components/locale-provider";

/**
 * Drop-in replacement for the old `window.location.reload()` pattern.
 * Changes the displayed language instantly without a full-page refresh.
 *
 * @example
 * const { locale, changeLocale, isPending } = useChangeLocale();
 * <button onClick={() => changeLocale("fr")} disabled={isPending}>Français</button>
 */
export function useChangeLocale() {
  return useLocaleContext();
}

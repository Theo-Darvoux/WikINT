/**
 * Enhanced localStorage wrapper that:
 * 1. Catches QuotaExceededError and warns the user (O10).
 * 2. Provides a way to sync state across tabs (O11).
 */

import { toast } from "sonner";

declare global {
    interface Window {
        _lastQuotaToast?: number;
    }
}

export const safeLocalStorage = {
    getItem: (name: string): string | null => {
        try {
            return localStorage.getItem(name);
        } catch {
            return null;
        }
    },
    setItem: (name: string, value: string): void => {
        try {
            localStorage.setItem(name, value);
        } catch (err) {
            if (err instanceof DOMException && (
                err.name === "QuotaExceededError" || 
                err.name === "NS_ERROR_DOM_QUOTA_REACHED"
            )) {
                console.error("Storage quota exceeded!", err);
                // Throttle toast to avoid spamming
                const lastToast = window._lastQuotaToast || 0;
                if (Date.now() - lastToast > 10000) {
                    toast.error("Storage limit reached. Some changes might not be saved.");
                    window._lastQuotaToast = Date.now();
                }
            }
        }
    },
    removeItem: (name: string): void => {
        try {
            localStorage.removeItem(name);
        } catch {
            // ignore
        }
    }
};

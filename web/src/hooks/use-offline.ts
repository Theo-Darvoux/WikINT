"use client";

import { useEffect, useState } from "react";

/**
 * Hook to track browser online/offline status (U4).
 */
export function useOffline() {
    const [isOffline, setIsOffline] = useState(
        typeof navigator !== "undefined" ? !navigator.onLine : false
    );

    useEffect(() => {
        const handleOnline = () => setIsOffline(false);
        const handleOffline = () => setIsOffline(true);

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, []);

    return isOffline;
}

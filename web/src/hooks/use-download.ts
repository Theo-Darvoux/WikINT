"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

export function useDownload() {
    const [isDownloading, setIsDownloading] = useState(false);

    const downloadMaterial = async (materialId: string, versionNumber?: number) => {
        // Open a blank tab synchronously while still in the user-gesture context
        // so popup blockers don't interfere with the later window.open call.
        const newTab = window.open("", "_blank");
        setIsDownloading(true);
        try {
            const endpoint = versionNumber
                ? `/materials/${materialId}/versions/${versionNumber}/download-url`
                : `/materials/${materialId}/download-url`;

            const { url } = await apiFetch<{ url: string }>(endpoint);

            if (newTab) {
                newTab.location.href = url;
            } else {
                // Popup was blocked — fall back to same-tab navigation.
                window.location.assign(url);
            }
        } catch (error) {
            newTab?.close();
            console.error("Download failed:", error);
            toast.error("Failed to start download. Please try again.");
        } finally {
            setIsDownloading(false);
        }
    };

    return { downloadMaterial, isDownloading };
}

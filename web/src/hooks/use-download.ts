"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

export function useDownload() {
    const [isDownloading, setIsDownloading] = useState(false);

    const downloadMaterial = async (materialId: string, versionNumber?: number) => {
        setIsDownloading(true);
        try {
            const endpoint = versionNumber
                ? `/materials/${materialId}/versions/${versionNumber}/download-url`
                : `/materials/${materialId}/download-url`;

            const { url, filename } = await apiFetch<{ url: string; filename?: string }>(endpoint);

            // Trigger the download in-place by creating a hidden anchor element.
            // Since the backend returns a URL with ResponseContentDisposition set to attachment, 
            // the browser will stay on the current page and initiate the download.
            const link = document.createElement("a");
            link.href = url;
            // Explicitly setting the download attribute with the filename ensures 
            // browsers prioritize the human-readable name over the obfuscated S3 hash.
            link.setAttribute("download", filename || "");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error("Download failed:", error);
            toast.error("Failed to start download. Please try again.");
        } finally {
            setIsDownloading(false);
        }
    };

    return { downloadMaterial, isDownloading };
}

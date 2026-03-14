"use client";

import { useState, useCallback } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";

interface UploadState {
    uploading: boolean;
    progress: number;
    error: string | null;
    fileKey: string | null;
}

interface UploadResult {
    file_key: string;
    size: number;
    mime_type: string;
}

export function useUpload() {
    const [state, setState] = useState<UploadState>({
        uploading: false,
        progress: 0,
        error: null,
        fileKey: null,
    });

    const upload = useCallback(async (file: File): Promise<UploadResult | null> => {
        setState({ uploading: true, progress: 0, error: null, fileKey: null });

        try {
            const { upload_url, file_key } = await apiFetch<{ upload_url: string; file_key: string }>(
                "/upload/request-url",
                {
                    method: "POST",
                    body: JSON.stringify({
                        filename: file.name,
                        size: file.size,
                        mime_type: file.type || "application/octet-stream",
                    }),
                }
            );

            setState((s) => ({ ...s, progress: 10 }));

            const xhr = new XMLHttpRequest();

            await new Promise<void>((resolve, reject) => {
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const pct = 10 + Math.round((e.loaded / e.total) * 80);
                        setState((s) => ({ ...s, progress: pct }));
                    }
                };
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) resolve();
                    else reject(new Error(`Upload failed with status ${xhr.status}`));
                };
                xhr.onerror = () => reject(new Error("Upload failed"));
                xhr.open("PUT", upload_url);
                xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
                xhr.send(file);
            });

            setState((s) => ({ ...s, progress: 90 }));

            const result = await apiFetch<UploadResult>("/upload/complete", {
                method: "POST",
                body: JSON.stringify({ file_key }),
            });

            setState({ uploading: false, progress: 100, error: null, fileKey: result.file_key });
            return result;
        } catch (err) {
            const message = err instanceof ApiError ? err.message : "Upload failed";
            setState({ uploading: false, progress: 0, error: message, fileKey: null });
            return null;
        }
    }, []);

    const reset = useCallback(() => {
        setState({ uploading: false, progress: 0, error: null, fileKey: null });
    }, []);

    return { ...state, upload, reset };
}

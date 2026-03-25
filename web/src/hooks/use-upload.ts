"use client";

import { useState, useCallback } from "react";
import { API_BASE, ApiError, getClientId } from "@/lib/api-client";
import { getAccessToken } from "@/lib/auth-tokens";

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
            const formData = new FormData();
            formData.append("file", file);

            const result = await new Promise<UploadResult>((resolve, reject) => {
                const xhr = new XMLHttpRequest();

                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        // 0-90% for upload, 90-100% reserved for server-side scanning
                        const pct = Math.round((e.loaded / e.total) * 90);
                        setState((s) => ({ ...s, progress: pct }));
                    }
                };

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(JSON.parse(xhr.responseText));
                    } else {
                        let message = "Upload failed";
                        try {
                            const body = JSON.parse(xhr.responseText);
                            message = body.detail ?? message;
                        } catch { /* ignore parse errors */ }
                        reject(new ApiError(xhr.status, message));
                    }
                };

                xhr.onerror = () => reject(new Error("Upload failed"));

                xhr.open("POST", `${API_BASE}/upload`);

                const token = getAccessToken();
                if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
                xhr.setRequestHeader("X-Client-ID", getClientId());
                // Do NOT set Content-Type — browser sets multipart boundary automatically

                xhr.send(formData);
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

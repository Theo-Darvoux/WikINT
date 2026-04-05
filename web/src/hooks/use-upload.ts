"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ApiError, apiRequest } from "@/lib/api-client";
import { uploadFile, UploadResult } from "@/lib/upload-client";
import { useUploadQueue } from "@/lib/upload-queue";

interface UploadState {
    uploading: boolean;
    progress: number;
    error: string | null;
    fileKey: string | null;
    detail: string | null;
    clientId: string | null;
}

export function useUpload() {
    const [state, setState] = useState<UploadState>({
        uploading: false,
        progress: 0,
        error: null,
        fileKey: null,
        detail: null,
        clientId: null,
    });

    const { addItems, updateItem, removeItem, items } = useUploadQueue();
    const abortControllerRef = useRef<AbortController | null>(null);

    // Track the current item from the global queue if we have a clientId
    useEffect(() => {
        if (!state.clientId) return;
        const item = items.find(i => i.clientId === state.clientId);
        if (!item) return;

        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState(s => ({
            ...s,
            uploading: item.status === "uploading" || item.status === "pending",
            progress: item.progress,
            error: item.error || null,
            fileKey: item.fileKey || null,
            detail: item.processingStatus || null,
        }));
    }, [items, state.clientId]);

    const upload = useCallback(async (file: File): Promise<UploadResult | null> => {
        abortControllerRef.current = new AbortController();
        const clientId = crypto.randomUUID();
        const uploadId = crypto.randomUUID();

        addItems([{
            clientId,
            uploadId,
            fileName: file.name,
            fileSize: file.size,
            fileMimeType: file.type,
            title: file.name,
            status: "pending",
            progress: 0,
            processingStatus: "Preparing...",
            targetDirPath: "",
        }]);

        setState(s => ({ ...s, clientId, uploading: true, progress: 0, error: null }));

        try {
            // We still use uploadFile directly here but it will update the queue
            // via the component that usually drives the queue, or we can drive it here.
            // For the hook to work standalone, we'll run it here.
            const result = await uploadFile(file, {
                onProgress: (pct) => updateItem(clientId, { progress: pct }),
                onStatusUpdate: (msg) => updateItem(clientId, { processingStatus: msg }),
                uploadId,
                signal: abortControllerRef.current.signal,
            });
            
            updateItem(clientId, { status: "done", progress: 100, fileKey: result.file_key });
            return result;
        } catch (err) {
            if (err instanceof Error && err.message === "Upload cancelled") return null;
            const message = err instanceof ApiError ? err.message : "Upload failed";
            updateItem(clientId, { status: "error", error: message });
            return null;
        }
    }, [addItems, updateItem]);

    /** Cancel an in-progress upload and (optionally) delete the quarantine object. */
    const cancel = useCallback(
        async (uploadId?: string) => {
            abortControllerRef.current?.abort();
            abortControllerRef.current = null;

            if (state.clientId) {
                removeItem(state.clientId);
            }
            setState({ uploading: false, progress: 0, error: null, fileKey: null, detail: null, clientId: null });

            if (uploadId) {
                // Best-effort server-side cleanup — fire and forget
                apiRequest(`/upload/${encodeURIComponent(uploadId)}`, { method: "DELETE" }).catch(
                    () => {},
                );
            }
        },
        [state.clientId, removeItem],
    );

    const reset = useCallback(() => {
        if (state.clientId) removeItem(state.clientId);
        setState({ uploading: false, progress: 0, error: null, fileKey: null, detail: null, clientId: null });
    }, [state.clientId, removeItem]);

    return { ...state, upload, cancel, reset };
}

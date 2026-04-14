"use client";

import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    UploadCloud,
    X,
    CheckCircle2,
    AlertCircle,
    Loader2,
    RotateCcw,
    PackagePlus,
    Folder,
    ShieldX,
    FileText,
    ImageIcon,
    Play,
    Pause,
} from "lucide-react";
import { toast } from "sonner";
import { useStagingStore } from "@/lib/staging-store";
import type { CreateMaterialOp } from "@/lib/staging-store";
import { cn } from "@/lib/utils";
import { MAX_FILE_SIZE_MB, ACCEPTED_FILE_TYPES } from "@/lib/file-utils";
import { uploadFile, getUploadConfig, logicalFileSize, type UploadConfig } from "@/lib/upload-client";
import { ApiError } from "@/lib/api-client";
import { TagInput } from "@/components/ui/tag-input";
import { useDropZoneStore } from "@/components/pr/global-drop-zone";
import { collectDroppedFiles, extractDirPaths, type ScannedFile } from "@/lib/drop-utils";




interface UploadDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** UUID of the current directory to upload into (null for root) */
    directoryId: string | null;
    /** Human readable path/name for display */
    directoryName?: string;
    /** When set, uploaded files become attachments of this material */
    parentMaterialId?: string | null;
    /** Files to auto-add when the drawer opens (from global drop zone) */
    initialFiles?: File[] | ScannedFile[];
}


const MAX_CONCURRENT_UPLOADS = 4; // simultaneous XHR uploads
const MAX_FILES_PER_BATCH = 50;

function fileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function titleFromFilename(name: string): string {
    // Remove extension, replace dashes/underscores with spaces, capitalize
    return name
        .replace(/\.[^.]+$/, "")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
}

/** Maps a directory relative path (e.g. "FolderA/sub") to its staging temp_id */
type DirPathMap = Map<string, string>;

interface SpeedEntry {
    lastBytes: number;
    lastTime: number;
    smoothedBps: number;
    measurements: number; // (U13) Track number of samples
}

import type { TusUploadHandle } from "@/lib/upload-client";

import { useUploadQueue } from "@/lib/upload-queue";
import type { QueueItem } from "@/lib/upload-queue";

export function UploadDrawer({
    open,
    onOpenChange,
    directoryId,
    directoryName,
    parentMaterialId,
    initialFiles,
}: UploadDrawerProps) {
    const addOperations = useStagingStore((s) => s.addOperations);
    const nextTempId = useStagingStore((s) => s.nextTempId);
    const setReviewOpen = useStagingStore((s) => s.setReviewOpen);

    // Use the persistent global queue instead of local state
    const {
        items: files,
        addItems,
        updateItem,
        removeItem,
        clearAll,
        setActiveCount,
    } = useUploadQueue();

    const doneFiles = useMemo(() => files.filter((i) => i.status === "done"), [files]);
    const errorFiles = useMemo(() => files.filter((i) => i.status === "error" || i.status === "virus"), [files]);
    const inFlightCount = useMemo(
        () => files.filter((i) => i.status === "uploading" || i.status === "pending").length,
        [files],
    );

    // Local-only non-serializable state
    const fileObjectsRef = useRef<Map<string, File>>(new Map());
    const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
    const tusHandlesRef = useRef<Map<string, TusUploadHandle>>(new Map());
    const previewUrlsRef = useRef<Map<string, string>>(new Map());
    const speedRef = useRef<Map<string, SpeedEntry>>(new Map());
    const [etaMap, setEtaMap] = useState<Map<string, { bps: number; etaSec: number }>>(new Map());

    const uploadQueueRef = useRef<string[]>([]); // Store clientIds

    const [pendingDirPaths, setPendingDirPaths] = useState<DirPathMap>(new Map());
    const [batchTags, setBatchTags] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropzoneRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const initialFilesProcessedRef = useRef(false);
    const [config, setConfig] = useState<UploadConfig | null>(null);

    // Fetch upload configuration on mount
    useEffect(() => {
        getUploadConfig().then(setConfig).catch(() => {
            // Fallback to defaults from file-utils if API fails
            setConfig({
                allowed_extensions: ACCEPTED_FILE_TYPES.split(","),
                allowed_mimetypes: [],
                max_file_size_mb: MAX_FILE_SIZE_MB,
            });
        });
    }, []);

    // (U2) Re-attach engine / handle lost file references on mount
    useEffect(() => {
        files.forEach((item) => {
            if ((item.status === "pending" || item.status === "uploading" || item.status === "paused") && !fileObjectsRef.current.has(item.clientId)) {
                // We lost the File object (refreshed page).
                // For now, mark as error since we can't recover the File handle.
                updateItem(item.clientId, {
                    status: "error",
                    error: "File reference lost after page refresh. Please remove and re-add this file.",
                });
            }
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── beforeunload handler (S17) ──
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (inFlightCount > 0) {
                e.preventDefault();
                e.returnValue = ""; // Standard requirement for modern browsers
            }
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [inFlightCount]);

    const startUpload = useCallback((clientId: string) => {
        const drainQueue = () => {
            const currentActive = useUploadQueue.getState().activeCount;
            if (currentActive < MAX_CONCURRENT_UPLOADS && uploadQueueRef.current.length > 0) {
                const nextId = uploadQueueRef.current.shift()!;
                const nextItem = useUploadQueue.getState().items.find(i => i.clientId === nextId);
                if (nextItem && (nextItem.status === "pending" || nextItem.status === "paused")) {
                    setActiveCount(currentActive + 1);
                    runUpload(nextId);
                }
            }
        };

        const runUpload = async (cid: string) => {
            const item = useUploadQueue.getState().items.find(i => i.clientId === cid);
            const file = fileObjectsRef.current.get(cid);

            if (!item || !file) {
                setActiveCount(Math.max(0, useUploadQueue.getState().activeCount - 1));
                drainQueue();
                return;
            }

            updateItem(cid, { status: "uploading", progress: item.progress || 0, error: undefined });
            const controller = new AbortController();
            abortControllersRef.current.set(cid, controller);

            try {
                const result = await uploadFile(file, {
                    onProgress: (pct) => updateItem(cid, { progress: pct }),
                    onStatusUpdate: (msg, stageIndex, stageTotal) => updateItem(cid, { processingStatus: msg, stageIndex, stageTotal }),
                    onBytesProgress: (uploaded, total) => {
                        const now = Date.now();
                        const prev = speedRef.current.get(cid) ?? {
                            lastBytes: 0,
                            lastTime: now,
                            smoothedBps: 0,
                            measurements: 0,
                        };
                        const dt = (now - prev.lastTime) / 1000;
                        const db = uploaded - prev.lastBytes;
                        const instant = dt > 0 ? db / dt : 0;
                        const smoothed =
                            prev.smoothedBps === 0 ? instant : 0.7 * prev.smoothedBps + 0.3 * instant;
                        const measurements = prev.measurements + 1;
                        speedRef.current.set(cid, {
                            lastBytes: uploaded,
                            lastTime: now,
                            smoothedBps: smoothed,
                            measurements,
                        });
                        
                        // (U13) Only update ETA after a few samples to avoid cold-start noise
                        if (measurements >= 3) {
                            const etaSec = smoothed > 0 ? Math.round((total - uploaded) / smoothed) : 0;
                            setEtaMap((m) => new Map(m).set(cid, { bps: smoothed, etaSec }));
                        }
                    },
                    onTusReady: (handle) => {
                        tusHandlesRef.current.set(cid, handle);
                    },
                    onTusUrlAvailable: (url) => {
                        updateItem(cid, { tusUrl: url });
                    },
                    signal: controller.signal,
                    uploadId: item.uploadId,
                    tusUrl: item.tusUrl,
                });

                const currentItem = useUploadQueue.getState().items.find(i => i.clientId === cid);

                updateItem(cid, {
                    status: "done",
                    progress: 100,
                    fileKey: result.file_key,
                    correctedName: result.correctedName,
                    serverSize: logicalFileSize(result),
                    mimeType: result.mime_type,
                    wasCompressed: result.wasCompressed,
                    // Auto-sync title if it hasn't been modified by user
                    title: currentItem?.title === titleFromFilename(file.name) ? titleFromFilename(result.correctedName) : currentItem?.title,
                });
            } catch (err) {
                const msg = err instanceof ApiError ? err.message : (err instanceof Error ? err.message : "Upload failed");
                if (msg !== "Upload cancelled") {
                    const isVirus = msg.includes("ERR_MALWARE_DETECTED");
                    updateItem(cid, {
                        status: isVirus ? "virus" : "error",
                        error: msg,
                    });
                }
            } finally {
                tusHandlesRef.current.delete(cid);
                speedRef.current.delete(cid);
                abortControllersRef.current.delete(cid);
                setEtaMap((m) => {
                    const next = new Map(m);
                    next.delete(cid);
                    return next;
                });
                setActiveCount(Math.max(0, useUploadQueue.getState().activeCount - 1));
                drainQueue();
            }
        };

        // Enqueue, then try to drain
        uploadQueueRef.current.push(clientId);
        drainQueue();
    }, [updateItem, setActiveCount]);

    /** Shared logic: validate, create dir temp IDs, build FileEntry[], start uploads. */
    const processScannedFiles = useCallback(
        (scanned: ScannedFile[]) => {
            if (scanned.length === 0) return;

            const currentMaxSize = (config?.max_file_size_mb || MAX_FILE_SIZE_MB) * 1024 * 1024;

            // ── Comprehensive client-side validation ──
            const oversized = scanned.filter((s) => s.file.size > currentMaxSize);
            oversized.forEach((s) =>
                toast.error(`${s.file.name} exceeds the ${config?.max_file_size_mb || MAX_FILE_SIZE_MB} MiB size limit`),
            );

            let valid = scanned.filter((s) => s.file.size <= currentMaxSize);

            if (config) {
                valid = valid.filter((s) => {
                    const f = s.file;
                    const ext = `.${f.name.split(".").pop()?.toLowerCase()}`;
                    const isAllowedExt = config.allowed_extensions.includes(ext);
                    const isAllowedMime = f.type ? config.allowed_mimetypes.includes(f.type) : false;

                    if (!isAllowedExt && !isAllowedMime && !f.type.startsWith("text/")) {
                        toast.error(`File type '${f.type || ext}' is not supported.`);
                        return false;
                    }
                    return true;
                });
            }

            if (valid.length === 0) return;

            const remaining = MAX_FILES_PER_BATCH - files.length;
            if (remaining <= 0) {
                toast.error(`Maximum ${MAX_FILES_PER_BATCH} files per batch`);
                return;
            }
            if (valid.length > remaining) {
                toast.warning(`Only adding ${remaining} file(s) — batch limit is ${MAX_FILES_PER_BATCH}`);
                valid = valid.slice(0, remaining);
            }

            // Build a temp_id map for each unique directory path
            const dirPaths = extractDirPaths(valid);
            if (dirPaths.length > 0) {
                const newDirMap: DirPathMap = new Map();
                for (const path of dirPaths) newDirMap.set(path, nextTempId("dir"));
                setPendingDirPaths((prev) => new Map([...prev, ...newDirMap]));
                toast.info(
                    `Detected ${dirPaths.length} folder${dirPaths.length > 1 ? "s" : ""}. They will be created when you stage.`,
                );
            }

            // Create FileEntry for each file
            const newItems: QueueItem[] = valid.map(({ file, relativePath }) => {
                const parts = relativePath.split("/");
                const dirPart = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
                const clientId = crypto.randomUUID();
                fileObjectsRef.current.set(clientId, file);

                // Create local preview if image/pdf
                if (file.type.startsWith("image/") || file.type === "application/pdf") {
                    previewUrlsRef.current.set(clientId, URL.createObjectURL(file));
                }

                return {
                    clientId,
                    uploadId: crypto.randomUUID(),
                    fileName: file.name,
                    fileSize: file.size,
                    fileMimeType: file.type || "application/octet-stream",
                    title: titleFromFilename(file.name),
                    status: "pending",
                    progress: 0,
                    processingStatus: "",
                    targetDirPath: dirPart,
                };
            });

            addItems(newItems);
            for (const item of newItems) startUpload(item.clientId);
        },
        [startUpload, nextTempId, addItems, files.length, config],
    );

    /** Add flat files (from file input or flat drag). All go to current directory. */
    const addFlatFiles = useCallback(
        (newFiles: FileList | File[] | ScannedFile[]) => {
            const currentCount = useUploadQueue.getState().items.length;
            const remaining = MAX_FILES_PER_BATCH - currentCount;
            if (remaining <= 0) {
                toast.error(`Maximum ${MAX_FILES_PER_BATCH} files per batch`);
                return;
            }
            const filesArray = Array.isArray(newFiles) ? newFiles : Array.from(newFiles);
            const capped = (filesArray as (File | ScannedFile)[]).slice(0, remaining);
            if (capped.length < newFiles.length) {
                toast.warning(`Only adding ${remaining} file(s) — batch limit is ${MAX_FILES_PER_BATCH}`);
            }

            const scanned: ScannedFile[] = capped.map(f => {
                if ("file" in f && "relativePath" in f) return f;
                return { file: f, relativePath: f.name };
            });

            processScannedFiles(scanned);
        },
        [processScannedFiles],
    );


    // Auto-process files passed from global drop zone or external trigger
    useEffect(() => {
        if (open && initialFiles && initialFiles.length > 0 && !initialFilesProcessedRef.current) {
            initialFilesProcessedRef.current = true;
            queueMicrotask(() => addFlatFiles(initialFiles));
        }
        if (!open) {
            initialFilesProcessedRef.current = false;
        }
    }, [open, initialFiles, addFlatFiles]);

    // When the drawer is open, intercept drops ANYWHERE on the page and add files
    const dismissOverlay = useDropZoneStore((s) => s.dismissOverlay);

    // Clipboard paste for images
    useEffect(() => {
        if (!open) return;
        const handlePaste = (e: ClipboardEvent) => {
            if (!e.clipboardData) return;
            const items = e.clipboardData.items;
            const imageFiles: File[] = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === "file" && item.type.startsWith("image/")) {
                    const file = item.getAsFile();
                    if (file) imageFiles.push(file);
                }
            }
            if (imageFiles.length > 0) {
                addFlatFiles(imageFiles);
            }
        };
        document.addEventListener("paste", handlePaste);
        return () => document.removeEventListener("paste", handlePaste);
    }, [open, addFlatFiles]);

    useEffect(() => {
        if (!open) return;

        const onDragOver = (e: DragEvent) => {
            if (!e.dataTransfer?.types.includes("Files")) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        };

        const onDrop = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dismissOverlay?.();
            if (!e.dataTransfer?.files.length) return;
            addFlatFiles(Array.from(e.dataTransfer.files));
        };

        // Use capture phase so we intercept before the Sheet overlay can swallow events
        document.addEventListener("dragover", onDragOver, true);
        document.addEventListener("drop", onDrop, true);

        return () => {
            document.removeEventListener("dragover", onDragOver, true);
            document.removeEventListener("drop", onDrop, true);
        };
    }, [open, addFlatFiles, dismissOverlay]);


    /** Process a DataTransferItemList — handles dropped folders recursively. */
    const processDropItems = useCallback(
        async (items: DataTransferItemList) => {
            let scanned: ScannedFile[];
            try {
                scanned = await collectDroppedFiles(items);
            } catch {
                toast.error("Failed to read dropped files");
                return;
            }
            processScannedFiles(scanned);
        },
        [processScannedFiles],
    );

    const retryFile = (clientId: string) => {
        const item = files.find((f) => f.clientId === clientId);
        if (!item) return;
        // Reset status to pending so it joins the queue
        updateItem(clientId, {
            status: "pending",
            progress: 0,
            processingStatus: "",
            error: undefined,
        });
        startUpload(clientId);
    };

    const removeFile = (clientId: string) => {
        const controller = abortControllersRef.current.get(clientId);
        if (controller) controller.abort();
        const tusHandle = tusHandlesRef.current.get(clientId);
        if (tusHandle) tusHandle.abort(true); // send DELETE to server

        // ── Revoke preview URL (O7) ──
        const preview = previewUrlsRef.current.get(clientId);
        if (preview) {
            URL.revokeObjectURL(preview);
            previewUrlsRef.current.delete(clientId);
        }

        removeItem(clientId);
        fileObjectsRef.current.delete(clientId);
    };

    const updateTitleField = (clientId: string, title: string) => {
        updateItem(clientId, { title });
    };

    const pauseUpload = (clientId: string) => {
        const handle = tusHandlesRef.current.get(clientId);
        if (handle) {
            handle.pause();
            updateItem(clientId, { status: "paused" });
            // On pause, we effectively free up a concurrency slot
            setActiveCount(Math.max(0, useUploadQueue.getState().activeCount - 1));
            // ── Drain queue to start next pending (U15) ──
            const item = files.find(f => f.clientId === clientId);
            if (item) {
                const nextPending = files.find(f => f.status === "pending" && !uploadQueueRef.current.includes(f.clientId));
                if (nextPending) startUpload(nextPending.clientId);
            }
        }
    };

    const resumeUpload = (clientId: string) => {
        const handle = tusHandlesRef.current.get(clientId);
        const entry = files.find((f) => f.clientId === clientId);
        if (handle && entry) {
            updateItem(clientId, { status: "uploading" });
            setActiveCount(useUploadQueue.getState().activeCount + 1);
            handle.resume();
        }
    };

    const inFlightFiles = files.filter(
        (f) => f.status === "uploading" || f.status === "pending" || f.status === "paused",
    );

    const canStage = doneFiles.length > 0 && inFlightCount === 0;

    const stageLabel =
        doneFiles.length === files.length
            ? `Add to draft (${doneFiles.length})`
            : `Add to draft (${doneFiles.length}/${files.length})`;

    const handleStage = () => {
        // ── Explicit messaging for errors (U14) ──
        if (errorFiles.length > 0) {
            const confirmed = window.confirm(
                `${errorFiles.length} file(s) failed and will not be included. Continue?`
            );
            if (!confirmed) return;
        }

        // Emit create_directory ops first (topological order: shallow before deep)
        const dirPaths = [...pendingDirPaths.keys()].sort(
            (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
        );

        const dirOps = dirPaths.map((path) => {
            const parts = path.split("/");
            const name = parts[parts.length - 1];
            const parentPath = parts.slice(0, -1).join("/");
            const parentId = parentPath
                ? pendingDirPaths.get(parentPath) ?? (directoryId || null)
                : (directoryId || null);
            return {
                op: "create_directory" as const,
                temp_id: pendingDirPaths.get(path)!,
                parent_id: parentId,
                name,
                type: "folder" as const,
                tags: batchTags.length > 0 ? batchTags : undefined,
            };
        });

        // Emit create_material ops
        const matOps: CreateMaterialOp[] = doneFiles.map((f: QueueItem) => {
            const dirId = f.targetDirPath
                ? (pendingDirPaths.get(f.targetDirPath) ?? (directoryId || null))
                : (directoryId || null);
            return {
                op: "create_material" as const,
                temp_id: nextTempId("mat"),
                directory_id: dirId!,
                title: f.title || titleFromFilename(f.correctedName ?? f.fileName),
                type: "document",
                file_key: f.fileKey!,
                file_name: f.correctedName ?? f.fileName,
                file_size: f.serverSize ?? f.fileSize,
                file_mime_type: f.mimeType || f.fileMimeType || "application/octet-stream",
                ...(parentMaterialId ? { parent_material_id: parentMaterialId } : {}),
                tags: batchTags.length > 0 ? batchTags : undefined,
            };
        });

        addOperations([...dirOps, ...matOps]);

        // Remove staged items from queue
        doneFiles.forEach((f: QueueItem) => {
            removeItem(f.clientId);
            fileObjectsRef.current.delete(f.clientId);
        });
        setPendingDirPaths(new Map());

        const total = dirOps.length + matOps.length;
        toast.success(`${total} change${total > 1 ? "s" : ""} added to draft`);

        if (errorFiles.length === 0) {
            onOpenChange(false);
            setReviewOpen(true);
        }
    };

    // Drag & drop handlers
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        processDropItems(e.dataTransfer.items);
    };

    const doClose = () => {
        // ── Abort all running uploads (U5) ──
        abortControllersRef.current.forEach((c) => c.abort());
        tusHandlesRef.current.forEach((h) => h.abort());

        files.forEach((f) => {
            const preview = previewUrlsRef.current.get(f.clientId);
            if (preview) URL.revokeObjectURL(preview);
        });
        clearAll();
        fileObjectsRef.current.clear();
        previewUrlsRef.current.clear();
        setPendingDirPaths(new Map());
        uploadQueueRef.current = [];
        onOpenChange(false);
    };

    const handleClose = (nextOpen: boolean) => {
        if (nextOpen) {
            onOpenChange(true);
            return;
        }
        // Block close while uploads are running
        if (inFlightFiles.length > 0) {
            toast.warning("Wait for uploads to finish before closing");
            return;
        }
        // Warn if done files are present but not yet staged (H-1)
        if (doneFiles.length > 0) {
            if (window.confirm(`${doneFiles.length} file${doneFiles.length > 1 ? "s" : ""} uploaded but not staged. Discard them?`)) {
                doClose();
            }
            return;
        }
        doClose();
    };

    return (
        <Sheet open={open} onOpenChange={handleClose}>
            <SheetContent
                side="right"
                className="flex w-full flex-col overflow-hidden sm:max-w-lg"
                onInteractOutside={(e) => {
                    e.preventDefault();
                    if (inFlightFiles.length > 0) {
                        toast.warning("Uploads are in progress — wait for them to finish");
                    }
                }}
                onPointerDownOutside={(e) => e.preventDefault()}
            >
                <SheetHeader>
                    <SheetTitle>{parentMaterialId ? "Upload Attachments" : "Upload Files"}</SheetTitle>
                    <SheetDescription>
                        {parentMaterialId ? (
                            <>
                                Attach files to{" "}
                                <span className="font-medium text-foreground">
                                    {directoryName || "this material"}
                                </span>
                                . They&apos;ll appear in your staged changes.
                            </>
                        ) : (
                            <>
                                Drop files or folders into{" "}
                                <span className="font-medium text-foreground">
                                    {directoryName || "this folder"}
                                </span>
                                . Folder structure is preserved.
                            </>
                        )}
                    </SheetDescription>
                </SheetHeader>

                <div className="space-y-1.5 py-4">
                    <label className="text-sm font-medium">Batch Tags</label>
                    <TagInput
                        tags={batchTags}
                        onChange={setBatchTags}
                        placeholder="Apply tags to all files and folders…"
                    />
                    <p className="text-[10px] text-muted-foreground">
                        Tags entered here will be applied to every file and folder in this batch.
                    </p>
                </div>

                {/* Dropzone — compact when files are present */}
                <div
                    ref={dropzoneRef}
                    role="region"
                    aria-label="Drop files or folders here"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            fileInputRef.current?.click();
                        }
                    }}
                    className={cn(
                        "cursor-pointer rounded-lg border-2 border-dashed transition-colors",
                        isDragging
                            ? "border-primary bg-primary/5"
                            : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30",
                        files.length === 0
                            ? "flex flex-col items-center justify-center gap-2 p-8"
                            : "flex items-center gap-3 px-4 py-2.5",
                    )}
                >
                    <UploadCloud
                        className={cn(
                            "pointer-events-none",
                            isDragging ? "text-primary" : "text-muted-foreground",
                            files.length === 0 ? "h-8 w-8" : "h-4 w-4 shrink-0",
                        )}
                    />
                    {files.length === 0 ? (
                        <div className="pointer-events-none flex flex-col items-center gap-2 text-center">
                            <p className="text-sm text-muted-foreground">
                                {isDragging
                                    ? "Drop files or folders here"
                                    : "Drag & drop files or folders, or click to browse"}
                            </p>
                            <p className="text-xs text-muted-foreground/70">
                                Max {MAX_FILE_SIZE_MB} MiB per file · Folder structure preserved on drop
                            </p>
                        </div>
                    ) : (
                        <p className="pointer-events-none text-xs text-muted-foreground">
                            {isDragging ? "Drop to add more" : "Drop more files or folders here"}
                        </p>
                    )}
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept={config?.allowed_extensions.join(",") || ACCEPTED_FILE_TYPES}
                        className="hidden"
                        onChange={(e) => {
                            if (e.target.files) addFlatFiles(e.target.files);
                            e.target.value = "";
                        }}
                    />
                </div>



                {/* Pending folders summary */}
                {pendingDirPaths.size > 0 && (
                    <div className="flex flex-wrap gap-1.5 rounded-lg border border-green-200 bg-green-50/60 dark:bg-green-950/20 px-3 py-2">
                        <span className="text-xs text-green-700 dark:text-green-400 font-medium w-full">
                            {pendingDirPaths.size} folder{pendingDirPaths.size > 1 ? "s" : ""} will be created:
                        </span>
                        {[...pendingDirPaths.keys()]
                            .sort((a, b) => {
                                const da = a.split("/").length;
                                const db = b.split("/").length;
                                return da !== db ? da - db : a.localeCompare(b);
                            })
                            .map((path) => (
                                <span
                                    key={path}
                                    className="inline-flex items-center gap-1 rounded border border-green-300 px-1.5 py-0.5 text-[10px] text-green-700 dark:text-green-400"
                                >
                                    <Folder className="h-2.5 w-2.5" />
                                    {path}
                                </span>
                            ))}
                    </div>
                )}

                {/* File list */}
                {files.length > 0 && (
                    <ScrollArea className="-mx-6 min-h-0 flex-1 px-6">
                        <div className="space-y-2 py-1">
                            {files.map((f) => (
                                <div
                                    key={f.clientId}
                                    className={cn(
                                        "group flex items-start gap-3 rounded-lg border p-3",
                                        f.status === "virus" &&
                                            "border-destructive bg-destructive/5 dark:bg-destructive/10 animate-[virus-pulse-border_2s_ease-in-out_3]",
                                    )}
                                >
                                    {/* Preview & Status */}
                                    <div className="flex flex-col items-center gap-1.5 shrink-0 mt-0.5">
                                        <div className="h-4 w-4">
                                            {f.status === "done" && (
                                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                            )}
                                            {f.status === "virus" && (
                                                <ShieldX className="h-4 w-4 text-destructive animate-[virus-shake_0.6s_ease-in-out_3]" />
                                            )}
                                            {f.status === "error" && (
                                                <AlertCircle className="h-4 w-4 text-destructive" />
                                            )}
                                            {(f.status === "uploading" || f.status === "pending") && (
                                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                            )}
                                        </div>

                                        {/* Local preview thumbnail */}
                                        <div className="h-9 w-9 overflow-hidden rounded border bg-muted/50 flex items-center justify-center">
                                            {previewUrlsRef.current.has(f.clientId) ? (
                                                fileObjectsRef.current.get(f.clientId)?.type === "application/pdf" ? (
                                                    <div className="flex flex-col items-center gap-0.5">
                                                        <FileText className="h-4 w-4 text-red-500" />
                                                        <span className="text-[8px] font-bold uppercase text-red-500">PDF</span>
                                                    </div>
                                                ) : (
                                                    /* eslint-disable-next-line @next/next/no-img-element */
                                                    <img
                                                        src={previewUrlsRef.current.get(f.clientId)}
                                                        alt="preview"
                                                        className="h-full w-full object-cover"
                                                    />
                                                )
                                            ) : (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    {f.fileMimeType.startsWith("image/") ? (
                                                        <ImageIcon className="h-4 w-4 text-muted-foreground/60" />
                                                    ) : (
                                                        <FileText className="h-4 w-4 text-muted-foreground/60" />
                                                    )}
                                                    <span className="text-[7px] font-medium uppercase text-muted-foreground/60">
                                                        {f.fileName.split(".").pop()?.slice(0, 3)}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="min-w-0 flex-1 space-y-1.5">
                                        <Input
                                            value={f.title}
                                            onChange={(e) =>
                                                updateTitleField(f.clientId, e.target.value)
                                            }
                                            className="h-7 text-sm font-medium"
                                            placeholder="Title"
                                        />
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span className="shrink-0">
                                                {f.serverSize != null
                                                    ? fileSize(f.serverSize)
                                                    : fileSize(f.fileSize)}
                                            </span>
                                            {f.wasCompressed && (
                                                <span className="shrink-0 rounded bg-blue-100 px-1 py-0.5 text-[9px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                                                    compressed
                                                </span>
                                            )}
                                        </div>
                                        {!fileObjectsRef.current.has(f.clientId) && (f.status === "pending" || f.status === "uploading" || f.status === "paused") && (
                                            <p className="text-[10px] text-destructive font-medium">
                                                File reference lost. Re-add file to resume.
                                            </p>
                                        )}
                                        {f.targetDirPath && (
                                            <div className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
                                                <Folder className="h-2.5 w-2.5 shrink-0" />
                                                <span className="truncate">{f.targetDirPath}</span>
                                            </div>
                                        )}
                                        {(f.status === "uploading" || f.status === "paused") && (
                                            <div className="flex flex-col gap-1.5">
                                                {/* Upload / transfer bar */}
                                                <div className="flex flex-col gap-0.5">
                                                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                                        <span>Upload</span>
                                                        {f.status !== "paused" && (
                                                            <span>
                                                                {Math.min(Math.round(f.progress * 100 / 80), 100)}%
                                                                {etaMap.get(f.clientId) && f.progress < 80 && (
                                                                    <span className="ml-1">
                                                                        · {((etaMap.get(f.clientId)?.bps ?? 0) / (1024 * 1024)).toFixed(1)} MB/s · ~{etaMap.get(f.clientId)?.etaSec}s
                                                                    </span>
                                                                )}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <Progress
                                                        value={f.progress < 80 ? Math.min(Math.round(f.progress * 100 / 80), 100) : 100}
                                                        className="h-1.5"
                                                    />
                                                </div>

                                                {/* Processing bar — server-side stages */}
                                                {f.status === "uploading" && f.progress >= 80 && (
                                                    <div className="flex flex-col gap-0.5">
                                                        <div className="flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                                            <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />
                                                            <span className="truncate">{f.processingStatus || "Processing…"}</span>
                                                            {f.stageIndex != null && f.stageTotal != null && (
                                                                <span className="ml-auto shrink-0 font-normal text-muted-foreground">
                                                                    {f.stageIndex + 1}/{f.stageTotal}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-amber-100 dark:bg-amber-950/40">
                                                            <div
                                                                className="h-full bg-amber-500 dark:bg-amber-400 transition-all duration-500 animate-pulse"
                                                                style={{ width: `${Math.min((f.progress - 80) * 5, 100)}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                {f.status === "paused" && (
                                                    <p className="text-[10px] text-muted-foreground">Paused</p>
                                                )}
                                            </div>
                                        )}
                                        {f.status === "virus" && (
                                            <div className="rounded-md bg-destructive/10 px-2 py-1.5">
                                                <p className="text-xs font-semibold text-destructive">
                                                    Threat detected — file rejected
                                                </p>
                                                <p className="mt-0.5 text-[10px] text-destructive/80">
                                                    This file was flagged as malicious by the virus scanner and has been deleted from storage. It cannot be uploaded.
                                                </p>
                                            </div>
                                        )}
                                        {f.status === "error" && f.error && (
                                            <p className="text-xs text-destructive">
                                                {f.error}
                                            </p>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex shrink-0 items-center gap-1">
                                        {f.status === "uploading" && tusHandlesRef.current.has(f.clientId) && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() => pauseUpload(f.clientId)}
                                                title="Pause"
                                            >
                                                <Pause className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                        {f.status === "paused" && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() => resumeUpload(f.clientId)}
                                                title="Resume"
                                            >
                                                <Play className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                        {f.status === "error" && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() =>
                                                    retryFile(f.clientId)
                                                }
                                                title="Retry"
                                            >
                                                <RotateCcw className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                            onClick={() =>
                                                removeFile(f.clientId)
                                            }
                                            title="Remove"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                )}

                <SheetFooter className="flex-col gap-2 sm:flex-col">
                    <Button
                        onClick={handleStage}
                        disabled={!canStage}
                        className="w-full gap-2"
                    >
                        <PackagePlus className="h-4 w-4" />
                        {stageLabel}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

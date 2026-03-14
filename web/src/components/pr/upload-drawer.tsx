"use client";

import { useCallback, useRef, useState, useEffect } from "react";
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
    Package,
    Folder,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { useStagingStore } from "@/lib/staging-store";
import type { CreateMaterialOp } from "@/lib/staging-store";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Recursive folder traversal via FileSystem API
// ---------------------------------------------------------------------------

interface ScannedFile {
    file: File;
    /** Relative path from the drop root including filename, e.g. "FolderA/sub/file.pdf" */
    relativePath: string;
}

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    const all: FileSystemEntry[] = [];
    while (true) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
            reader.readEntries(res, rej),
        );
        if (batch.length === 0) break;
        all.push(...batch);
    }
    return all;
}

const MAX_TRAVERSE_DEPTH = 20;

async function traverseEntry(
    entry: FileSystemEntry,
    pathPrefix: string,
    out: ScannedFile[],
    visited: Set<string>,
    depth: number,
): Promise<void> {
    if (depth > MAX_TRAVERSE_DEPTH) return; // guard against very deep trees

    if (entry.isFile) {
        const file = await new Promise<File>((res, rej) =>
            (entry as FileSystemFileEntry).file(res, rej),
        );
        out.push({ file, relativePath: pathPrefix + file.name });
    } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        // Use the full path to detect symlink cycles
        const fullPath = dirEntry.fullPath;
        if (visited.has(fullPath)) return; // cycle detected — skip
        visited.add(fullPath);
        const children = await readAllEntries(dirEntry.createReader());
        for (const child of children) {
            await traverseEntry(child, pathPrefix + dirEntry.name + "/", out, visited, depth + 1);
        }
    }
}

/** Collect all files from a DataTransferItemList, preserving folder structure. */
async function collectDroppedFiles(items: DataTransferItemList): Promise<ScannedFile[]> {
    const out: ScannedFile[] = [];
    const visited = new Set<string>(); // shared across all top-level entries
    const promises: Promise<void>[] = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== "file") continue;
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
            promises.push(traverseEntry(entry, "", out, visited, 0));
        } else {
            // Fallback: no FileSystem API support
            const f = item.getAsFile();
            if (f) out.push({ file: f, relativePath: f.name });
        }
    }
    await Promise.all(promises);
    return out;
}

/** Derive all unique directory paths from a list of file paths (excluding root ""). */
function extractDirPaths(scanned: ScannedFile[]): string[] {
    const dirs = new Set<string>();
    for (const { relativePath } of scanned) {
        const parts = relativePath.split("/");
        // Parts: ["FolderA", "sub", "file.pdf"] → dirs: ["FolderA", "FolderA/sub"]
        for (let i = 1; i < parts.length; i++) {
            dirs.add(parts.slice(0, i).join("/"));
        }
    }
    // Sort by depth so parents come before children
    return [...dirs].sort((a, b) => {
        const da = a.split("/").length;
        const db = b.split("/").length;
        return da !== db ? da - db : a.localeCompare(b);
    });
}

interface UploadDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** UUID of the current directory to upload into */
    directoryId: string;
    /** Human readable path/name for display */
    directoryName?: string;
    /** When set, uploaded files become attachments of this material */
    parentMaterialId?: string | null;
    /** Files to auto-add when the drawer opens (from global drop zone) */
    initialFiles?: File[];
}

interface UploadRequestOut {
    upload_url: string;
    file_key: string;
    mime_type: string;
}

const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GB
const MAX_CONCURRENT_UPLOADS = 4; // simultaneous XHR uploads

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

interface FileEntry {
    clientId: string;
    file: File;
    title: string;
    status: "pending" | "uploading" | "scanned" | "done" | "error";
    progress: number;
    fileKey?: string;
    mimeType?: string;
    error?: string;
    xhr?: XMLHttpRequest;
    /** Relative directory path from drop root, e.g. "FolderA/sub". "" = current dir. */
    targetDirPath: string;
}

/** Maps a directory relative path (e.g. "FolderA/sub") to its staging temp_id */
type DirPathMap = Map<string, string>;

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
    const [files, setFiles] = useState<FileEntry[]>([]);
    // Upload concurrency queue
    const uploadQueueRef = useRef<FileEntry[]>([]);
    const activeUploadsRef = useRef(0);
    /**
     * Tracks staged directory paths from a folder drop.
     * Key = relative dir path (e.g. "FolderA/sub"), value = temp_id.
     */
    const [pendingDirPaths, setPendingDirPaths] = useState<DirPathMap>(new Map());
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const dropzoneRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const initialFilesProcessedRef = useRef(false);

    const startUpload = useCallback((entry: FileEntry) => {
        const updateEntry = (clientId: string, patch: Partial<FileEntry>) => {
            setFiles((prev) =>
                prev.map((f) => (f.clientId === clientId ? { ...f, ...patch } : f)),
            );
        };

        const drainQueue = () => {
            while (
                activeUploadsRef.current < MAX_CONCURRENT_UPLOADS &&
                uploadQueueRef.current.length > 0
            ) {
                const next = uploadQueueRef.current.shift()!;
                activeUploadsRef.current++;
                runUpload(next);
            }
        };

        const runUpload = async (e: FileEntry) => {
            updateEntry(e.clientId, { status: "uploading", progress: 0, error: undefined });
            try {
                const { upload_url, file_key, mime_type } =
                    await apiFetch<UploadRequestOut>("/upload/request-url", {
                        method: "POST",
                        body: JSON.stringify({
                            filename: e.file.name,
                            size: e.file.size,
                            mime_type: e.file.type || "application/octet-stream",
                        }),
                    });

                const xhr = new XMLHttpRequest();
                updateEntry(e.clientId, { xhr });
                xhr.open("PUT", upload_url, true);
                xhr.setRequestHeader("Content-Type", mime_type);
                xhr.upload.onprogress = (ev) => {
                    if (ev.lengthComputable) {
                        updateEntry(e.clientId, {
                            progress: Math.round((ev.loaded / ev.total) * 100),
                        });
                    }
                };

                await new Promise<void>((resolve, reject) => {
                    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed")));
                    xhr.onerror = () => reject(new Error("Network error"));
                    xhr.onabort = () => reject(new Error("Upload cancelled"));
                    xhr.send(e.file);
                });

                updateEntry(e.clientId, { status: "scanned", progress: 100 });
                await apiFetch("/upload/complete", {
                    method: "POST",
                    body: JSON.stringify({ file_key }),
                });

                updateEntry(e.clientId, {
                    status: "done",
                    progress: 100,
                    fileKey: file_key,
                    mimeType: mime_type,
                    xhr: undefined,
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Upload failed";
                if (msg !== "Upload cancelled") {
                    updateEntry(e.clientId, { status: "error", error: msg, xhr: undefined });
                }
            } finally {
                activeUploadsRef.current--;
                drainQueue();
            }
        };

        // Enqueue, then try to drain
        uploadQueueRef.current.push(entry);
        drainQueue();
    }, []);

    /** Add flat files (from file input or flat drag). All go to current directory. */
    const addFlatFiles = useCallback(
        (newFiles: FileList | File[]) => {
            const entries: FileEntry[] = Array.from(newFiles)
                .filter((f) => {
                    if (f.size > MAX_FILE_SIZE) {
                        toast.error(`${f.name} exceeds the 1 GB size limit`);
                        return false;
                    }
                    return true;
                })
                .map((f) => ({
                    clientId: crypto.randomUUID(),
                    file: f,
                    title: titleFromFilename(f.name),
                    status: "pending" as const,
                    progress: 0,
                    targetDirPath: "",
                }));
            if (entries.length === 0) return;
            setFiles((prev) => [...prev, ...entries]);
            for (const entry of entries) startUpload(entry);
        },
        [startUpload],
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

            if (scanned.length === 0) return;

            const oversized = scanned.filter((s) => s.file.size > MAX_FILE_SIZE);
            oversized.forEach((s) => toast.error(`${s.file.name} exceeds the 1 GB size limit`));
            const valid = scanned.filter((s) => s.file.size <= MAX_FILE_SIZE);
            if (valid.length === 0) return;

            // Build a temp_id map for each unique directory path
            const dirPaths = extractDirPaths(valid);
            const newDirMap: DirPathMap = new Map();
            for (const path of dirPaths) {
                newDirMap.set(path, nextTempId("dir"));
            }
            setPendingDirPaths((prev) => new Map([...prev, ...newDirMap]));

            // Create FileEntry for each file
            const entries: FileEntry[] = valid.map(({ file, relativePath }) => {
                const parts = relativePath.split("/");
                const dirPart = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
                return {
                    clientId: crypto.randomUUID(),
                    file,
                    title: titleFromFilename(file.name),
                    status: "pending" as const,
                    progress: 0,
                    targetDirPath: dirPart,
                };
            });

            setFiles((prev) => [...prev, ...entries]);
            for (const entry of entries) startUpload(entry);

            if (dirPaths.length > 0) {
                toast.info(
                    `Detected ${dirPaths.length} folder${dirPaths.length > 1 ? "s" : ""}. They will be created when you stage.`,
                );
            }
        },
        [startUpload, nextTempId],
    );

    const retryFile = (clientId: string) => {
        const entry = files.find((f) => f.clientId === clientId);
        if (!entry) return;
        // Reset status to pending so it joins the queue
        setFiles((prev) =>
            prev.map((f) => f.clientId === clientId ? { ...f, status: "pending" as const, progress: 0, error: undefined } : f),
        );
        startUpload({ ...entry, status: "pending", progress: 0, error: undefined });
    };

    const removeFile = (clientId: string) => {
        const entry = files.find((f) => f.clientId === clientId);
        if (entry?.xhr) entry.xhr.abort();
        setFiles((prev) => prev.filter((f) => f.clientId !== clientId));
    };

    const updateTitle = (clientId: string, title: string) => {
        setFiles((prev) =>
            prev.map((f) => (f.clientId === clientId ? { ...f, title } : f)),
        );
    };

    const doneFiles = files.filter((f) => f.status === "done");
    const inFlightFiles = files.filter(
        (f) => f.status === "uploading" || f.status === "scanned" || f.status === "pending",
    );
    const errorFiles = files.filter((f) => f.status === "error");

    const canStage = doneFiles.length > 0 && inFlightFiles.length === 0;

    const stageLabel =
        doneFiles.length === files.length
            ? `Stage All (${doneFiles.length})`
            : `Stage ${doneFiles.length} of ${files.length}`;

    const handleStage = () => {
        // Emit create_directory ops first (topological order: shallow before deep)
        const dirPaths = [...pendingDirPaths.keys()].sort(
            (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
        );

        const dirOps = dirPaths.map((path) => {
            const parts = path.split("/");
            const name = parts[parts.length - 1];
            const parentPath = parts.slice(0, -1).join("/");
            const parentId = parentPath
                ? pendingDirPaths.get(parentPath) ?? directoryId
                : directoryId;
            return {
                op: "create_directory" as const,
                temp_id: pendingDirPaths.get(path)!,
                parent_id: parentId,
                name,
                type: "folder" as const,
            };
        });

        // Emit create_material ops
        const matOps: CreateMaterialOp[] = doneFiles.map((f) => {
            const dirId = f.targetDirPath
                ? (pendingDirPaths.get(f.targetDirPath) ?? directoryId)
                : directoryId;
            return {
                op: "create_material" as const,
                temp_id: nextTempId("mat"),
                directory_id: dirId,
                title: f.title || titleFromFilename(f.file.name),
                type: "document",
                file_key: f.fileKey!,
                file_name: f.file.name,
                file_size: f.file.size,
                file_mime_type: f.mimeType || f.file.type || "application/octet-stream",
                ...(parentMaterialId ? { parent_material_id: parentMaterialId } : {}),
            };
        });

        addOperations([...dirOps, ...matOps]);

        setFiles((prev) => prev.filter((f) => f.status === "error"));
        setPendingDirPaths(new Map());

        const total = dirOps.length + matOps.length;
        toast.success(`${total} operation${total > 1 ? "s" : ""} staged`);

        if (errorFiles.length === 0) onOpenChange(false);
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

    const handleClose = (nextOpen: boolean) => {
        if (!nextOpen && inFlightFiles.length > 0) {
            toast.warning("Wait for uploads to finish before closing");
            return;
        }
        if (!nextOpen) {
            setFiles([]);
            setPendingDirPaths(new Map());
            uploadQueueRef.current = [];
        }
        onOpenChange(nextOpen);
    };

    return (
        <Sheet open={open} onOpenChange={handleClose}>
            <SheetContent
                side="right"
                className="flex w-full flex-col overflow-hidden sm:max-w-lg"
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
                                . They&apos;ll be staged in your cart.
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

                {/* Dropzone — compact when files are present */}
                <div
                    ref={dropzoneRef}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
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
                            isDragging ? "text-primary" : "text-muted-foreground",
                            files.length === 0 ? "h-8 w-8" : "h-4 w-4 shrink-0",
                        )}
                    />
                    {files.length === 0 ? (
                        <>
                            <p className="text-sm text-muted-foreground text-center">
                                {isDragging
                                    ? "Drop files or folders here"
                                    : "Drag & drop files or folders, or click to browse"}
                            </p>
                            <p className="text-xs text-muted-foreground/70">
                                Max 1 GB per file · Folder structure preserved on drop
                            </p>
                        </>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            {isDragging ? "Drop to add more" : "Drop more files or folders here"}
                        </p>
                    )}
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                            if (e.target.files) addFlatFiles(e.target.files);
                            e.target.value = "";
                        }}
                    />
                </div>

                {/* Browse folder button (below dropzone) */}
                <div className="flex justify-center">
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 text-xs"
                        onClick={() => folderInputRef.current?.click()}
                    >
                        <Folder className="h-3.5 w-3.5" />
                        Browse Folder…
                    </Button>
                    {/* Hidden folder picker */}
                    <input
                        ref={folderInputRef}
                        type="file"
                        // @ts-expect-error webkitdirectory is non-standard but widely supported
                        webkitdirectory=""
                        multiple
                        className="hidden"
                        onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                                // Build ScannedFile list from webkitRelativePath
                                const scanned: ScannedFile[] = Array.from(e.target.files).map((f) => ({
                                    file: f,
                                    relativePath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
                                }));
                                const dirPaths = extractDirPaths(scanned);
                                const newDirMap: DirPathMap = new Map();
                                for (const path of dirPaths) newDirMap.set(path, nextTempId("dir"));
                                setPendingDirPaths((prev) => new Map([...prev, ...newDirMap]));

                                const entries: FileEntry[] = scanned
                                    .filter((s) => {
                                        if (s.file.size > MAX_FILE_SIZE) {
                                            toast.error(`${s.file.name} exceeds the 1 GB size limit`);
                                            return false;
                                        }
                                        return true;
                                    })
                                    .map(({ file, relativePath }) => {
                                        const parts = relativePath.split("/");
                                        const dirPart = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
                                        return {
                                            clientId: crypto.randomUUID(),
                                            file,
                                            title: titleFromFilename(file.name),
                                            status: "pending" as const,
                                            progress: 0,
                                            targetDirPath: dirPart,
                                        };
                                    });

                                setFiles((prev) => [...prev, ...entries]);
                                for (const entry of entries) startUpload(entry);
                                if (dirPaths.length > 0) toast.info(`${dirPaths.length} folder${dirPaths.length > 1 ? "s" : ""} detected`);
                            }
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
                            .sort()
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
                                    className="group flex items-start gap-3 rounded-lg border p-3"
                                >
                                    {/* Status icon */}
                                    <div className="mt-0.5 shrink-0">
                                        {f.status === "done" && (
                                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                                        )}
                                        {f.status === "error" && (
                                            <AlertCircle className="h-4 w-4 text-destructive" />
                                        )}
                                        {(f.status === "uploading" ||
                                            f.status === "scanned") && (
                                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                        )}
                                        {f.status === "pending" && (
                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                        )}
                                    </div>

                                    {/* Details */}
                                    <div className="min-w-0 flex-1 space-y-1.5">
                                        <Input
                                            value={f.title}
                                            onChange={(e) =>
                                                updateTitle(f.clientId, e.target.value)
                                            }
                                            className="h-7 text-sm font-medium"
                                            placeholder="Title"
                                        />
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span className="truncate">
                                                {f.file.name}
                                            </span>
                                            <span className="shrink-0">
                                                {fileSize(f.file.size)}
                                            </span>
                                        </div>
                                        {f.targetDirPath && (
                                            <div className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
                                                <Folder className="h-2.5 w-2.5 shrink-0" />
                                                <span className="truncate">{f.targetDirPath}</span>
                                            </div>
                                        )}
                                        {(f.status === "uploading" ||
                                            f.status === "scanned") && (
                                            <Progress
                                                value={f.progress}
                                                className="h-1.5"
                                            />
                                        )}
                                        {f.status === "error" && f.error && (
                                            <p className="text-xs text-destructive">
                                                {f.error}
                                            </p>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex shrink-0 items-center gap-1">
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
                        <Package className="h-4 w-4" />
                        {stageLabel}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

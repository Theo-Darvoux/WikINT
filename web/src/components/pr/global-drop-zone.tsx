"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { UploadCloud } from "lucide-react";
import { create } from "zustand";
import { UploadDrawer } from "@/components/pr/upload-drawer";
import { usePathname } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Lightweight store so other components can open the upload drawer with context
// ---------------------------------------------------------------------------

interface UploadTarget {
    directoryId: string;
    directoryName: string;
    parentMaterialId?: string | null;
}

interface DropZoneState {
    /** Files buffered from a global drop, waiting for the drawer to consume */
    droppedFiles: DataTransferItemList | null;
    /** Explicit open request from a button (e.g. "Upload Attachment") */
    uploadTarget: UploadTarget | null;
    /** Current browse context kept in sync by DirectoryListing (includes ghost dirs) */
    browseContext: UploadTarget | null;
    /** Open the upload drawer for the given target */
    requestUpload: (target: UploadTarget) => void;
    /** Set dropped files (from the global drop handler) */
    setDroppedFiles: (items: DataTransferItemList | null) => void;
    /** Update the current browse context (called by DirectoryListing) */
    setBrowseContext: (ctx: UploadTarget | null) => void;
    /** Clear everything */
    clear: () => void;
}

export const useDropZoneStore = create<DropZoneState>((set) => ({
    droppedFiles: null,
    uploadTarget: null,
    browseContext: null,
    requestUpload: (target) => set({ uploadTarget: target, droppedFiles: null }),
    setDroppedFiles: (items) => set({ droppedFiles: items }),
    setBrowseContext: (ctx) => set({ browseContext: ctx }),
    clear: () => set({ droppedFiles: null, uploadTarget: null }),
}));

// ---------------------------------------------------------------------------
// Resolve the current browse context from the URL path
// ---------------------------------------------------------------------------

interface BrowseContext {
    directoryId: string;
    directoryName: string;
}

async function resolveBrowseContext(pathname: string): Promise<BrowseContext | null> {
    // Only works on /browse pages
    if (!pathname.startsWith("/browse")) return null;

    const slug = pathname.replace(/^\/browse\/?/, "") || "";
    try {
        const endpoint = slug ? `/browse/${slug}` : "/browse";
        const data = await apiFetch<{
            type: string;
            directory?: { id: string; name: string } | null;
            material?: { id: string; title: string; directory_id?: string } | null;
        }>(endpoint);

        if (data.type === "directory_listing" && data.directory) {
            return {
                directoryId: data.directory.id,
                directoryName: data.directory.name,
            };
        }
        // Root directory
        if (data.type === "directory_listing" && !data.directory) {
            return { directoryId: "", directoryName: "Root" };
        }
    } catch {
        // Can't resolve — fall back to root
    }
    return null;
}

// ---------------------------------------------------------------------------
// Global Drop Zone component — renders full-screen overlay on drag
// ---------------------------------------------------------------------------

export function GlobalDropZone() {
    const pathname = usePathname();
    const [isDragOver, setIsDragOver] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [target, setTarget] = useState<UploadTarget | null>(null);
    const dragCounterRef = useRef(0);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);

    const { uploadTarget, browseContext, clear } = useDropZoneStore();

    // Handle explicit upload requests from other components
    useEffect(() => {
        if (uploadTarget) {
            queueMicrotask(() => {
                setTarget(uploadTarget);
                setDrawerOpen(true);
            });
        }
    }, [uploadTarget]);

    const handleDrawerClose = useCallback(
        (open: boolean) => {
            setDrawerOpen(open);
            if (!open) {
                clear();
                setPendingFiles([]);
                // Reset drag state — prevents the overlay from re-appearing
                // when the drawer handled the drop internally (stopPropagation).
                dragCounterRef.current = 0;
                setIsDragOver(false);
            }
        },
        [clear],
    );

    // Resolve target and open dock drawer with the given files
    const handleFileDrop = useCallback(
        async (files: File[]) => {
            setPendingFiles(files);

            // Prefer the live browse context (tracks ghost dirs) over an API fetch
            if (browseContext) {
                setTarget(browseContext);
            } else {
                const ctx = await resolveBrowseContext(pathname);
                if (ctx) {
                    setTarget({
                        directoryId: ctx.directoryId,
                        directoryName: ctx.directoryName,
                    });
                } else {
                    setTarget({
                        directoryId: "",
                        directoryName: "Root",
                    });
                }
            }
            setDrawerOpen(true);
        },
        [browseContext, pathname],
    );

    // Listen for drag events on the document (show/hide overlay)
    useEffect(() => {
        const onDragEnter = (e: DragEvent) => {
            // Only react to file drags
            if (!e.dataTransfer?.types.includes("Files")) return;
            e.preventDefault();
            dragCounterRef.current++;
            if (dragCounterRef.current === 1) {
                setIsDragOver(true);
            }
        };

        const onDragOver = (e: DragEvent) => {
            if (!e.dataTransfer?.types.includes("Files")) return;
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "copy";
            }
        };

        const onDragLeave = (e: DragEvent) => {
            e.preventDefault();
            dragCounterRef.current--;
            if (dragCounterRef.current <= 0) {
                dragCounterRef.current = 0;
                setIsDragOver(false);
            }
        };

        // Fallback: catch drops that escape the overlay (e.g. dropped outside it)
        const onDrop = (e: DragEvent) => {
            if (drawerOpen) {
                dragCounterRef.current = 0;
                setIsDragOver(false);
                return;
            }
            e.preventDefault();
            dragCounterRef.current = 0;
            setIsDragOver(false);
        };

        document.addEventListener("dragenter", onDragEnter);
        document.addEventListener("dragover", onDragOver);
        document.addEventListener("dragleave", onDragLeave);
        document.addEventListener("drop", onDrop);

        return () => {
            document.removeEventListener("dragenter", onDragEnter);
            document.removeEventListener("dragover", onDragOver);
            document.removeEventListener("dragleave", onDragLeave);
            document.removeEventListener("drop", onDrop);
        };
    }, [drawerOpen]);

    // Drop handler for the overlay element itself
    const handleOverlayDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }, []);

    const handleOverlayDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounterRef.current = 0;
            setIsDragOver(false);

            if (!e.dataTransfer?.files.length) return;
            const files = Array.from(e.dataTransfer.files);
            handleFileDrop(files);
        },
        [handleFileDrop],
    );

    return (
        <>
            {/* Full-screen overlay when dragging files */}
            {isDragOver && !drawerOpen && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
                    onDragOver={handleOverlayDragOver}
                    onDrop={handleOverlayDrop}
                >
                    <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-primary bg-primary/5 px-16 py-12">
                        <UploadCloud className="h-16 w-16 text-primary animate-bounce" />
                        <div className="text-center">
                            <p className="text-lg font-semibold text-primary">
                                Drop files to upload
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                                Files will be staged into your cart
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Upload drawer rendered here with the resolved target */}
            {target && (
                <UploadDrawer
                    open={drawerOpen}
                    onOpenChange={handleDrawerClose}
                    directoryId={target.directoryId}
                    directoryName={target.directoryName}
                    parentMaterialId={target.parentMaterialId}
                    initialFiles={pendingFiles}
                />
            )}
        </>
    );
}

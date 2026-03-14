"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download, Paperclip } from "lucide-react";
import { useIsMobile, useIsDesktop } from "@/hooks/use-media-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatFileSize, getFileExtension } from "@/lib/file-utils";
import { useUIStore } from "@/lib/stores";
import { apiFetch } from "@/lib/api-client";
import { PdfViewer } from "@/components/viewers/pdf-viewer";
import { MarkdownViewer } from "@/components/viewers/markdown-viewer";
import { ImageViewer } from "@/components/viewers/image-viewer";
import { VideoPlayer } from "@/components/viewers/video-player";
import { CodeViewer } from "@/components/viewers/code-viewer";
import { OfficeViewer } from "@/components/viewers/office-viewer";
import { GenericViewer } from "@/components/viewers/generic-viewer";
import { EpubViewer } from "@/components/viewers/epub-viewer";
import { DjvuViewer } from "@/components/viewers/djvu-viewer";
import { SharedSidebar } from "@/components/sidebar/shared-sidebar";
import { ViewerFab } from "@/components/browse/viewer-fab";
import { Breadcrumbs } from "@/components/browse/breadcrumbs";
import { AnnotationSelectionTooltip } from "@/components/annotations/annotation-selection-tooltip";
import { useAnnotations } from "@/hooks/use-annotations";

interface MaterialViewerProps {
    material: Record<string, unknown>;
    breadcrumbs?: { id: string; name: string; slug: string }[];
}

const MIME_TO_VIEWER: Record<string, string> = {
    "application/pdf": "pdf",
    "text/markdown": "markdown",
    "text/x-markdown": "markdown",
    "image/png": "image",
    "image/jpeg": "image",
    "image/gif": "image",
    "image/webp": "image",
    "image/svg+xml": "image",
    "video/mp4": "video",
    "video/webm": "video",
    "video/ogg": "video",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "office",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "office",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "office",
    "application/msword": "office", // doc
    "application/vnd.ms-excel": "office", // xls
    "application/vnd.ms-powerpoint": "office", // ppt
    "application/vnd.oasis.opendocument.text": "office", // odt
    "application/vnd.oasis.opendocument.spreadsheet": "office", // ods
    "application/epub+zip": "epub",
    "image/vnd.djvu": "djvu",
    "image/x-djvu": "djvu",
    "application/x-tex": "code",
    "text/x-tex": "code",
};

const CODE_EXTENSIONS = new Set([
    "js", "ts", "jsx", "tsx", "py", "java", "c", "cpp", "h", "hpp",
    "rs", "go", "rb", "php", "cs", "swift", "kt", "scala",
    "html", "css", "scss", "json", "yaml", "yml", "toml", "xml",
    "sql", "sh", "bash", "zsh", "fish", "ps1",
    "lua", "r", "m", "ml", "hs", "ex", "exs", "clj",
    "txt", "log", "csv", "ini", "cfg", "conf", "tex", "latex",
]);

// Fallback: map file extensions to viewer types when MIME is unknown
const EXT_TO_VIEWER: Record<string, string> = {
    "pdf": "pdf",
    "md": "markdown",
    "png": "image", "jpg": "image", "jpeg": "image", "gif": "image",
    "webp": "image", "svg": "image",
    "mp4": "video", "webm": "video", "ogg": "video",
    "docx": "office", "xlsx": "office", "pptx": "office",
    "doc": "office", "xls": "office", "ppt": "office",
    "odt": "office", "ods": "office",
    "epub": "epub",
    "djvu": "djvu", "djv": "djvu",
};

function getViewerType(mimeType: string, fileName: string): string {
    // 1. Exact MIME match
    if (MIME_TO_VIEWER[mimeType]) return MIME_TO_VIEWER[mimeType];

    // 2. MIME prefix match
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("text/")) return "code";

    // 3. File extension fallback (handles octet-stream / unknown MIME)
    const ext = getFileExtension(fileName);
    if (EXT_TO_VIEWER[ext]) return EXT_TO_VIEWER[ext];
    if (CODE_EXTENSIONS.has(ext)) return "code";

    return "generic";
}

export function MaterialViewer({ material, breadcrumbs = [] }: MaterialViewerProps) {
    const router = useRouter();
    const pathname = usePathname();
    const isMobile = useIsMobile();
    const isDesktop = useIsDesktop();
    const { openSidebar } = useUIStore();
    const viewerContainerRef = useRef<HTMLDivElement>(null);

    const title = String(material.title ?? "");
    const materialType = String(material.type ?? "other");
    const directoryId = String(material.directory_id ?? "");
    const parentMaterialId = material.parent_material_id
        ? String(material.parent_material_id)
        : null;
    const attachmentCount = Number(material.attachment_count ?? 0);
    const versionInfo = material.current_version_info as Record<string, unknown> | null;
    const fileName = String(versionInfo?.file_name ?? "");
    const fileSize = Number(versionInfo?.file_size ?? 0);
    const mimeType = String(versionInfo?.file_mime_type ?? "application/octet-stream");
    const fileKey = String(versionInfo?.file_key ?? "");
    const materialId = String(material.id ?? "");

    // Record view in background
    useEffect(() => {
        if (!materialId) return;
        apiFetch(`/materials/${materialId}/view`, { method: "POST" }).catch(() => {
            // Silently fail if view tracking fails
        });
    }, [materialId]);

    const viewerType = getViewerType(mimeType, fileName);
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";
    const downloadUrl = `${apiBase}/materials/${materialId}/download`;

    const { createAnnotation, threads } = useAnnotations(materialId);

    const handleAnnotationSubmit = async (
        body: string,
        selectionText: string,
        positionData: Record<string, unknown>
    ) => {
        const docPage = typeof positionData.page === "number" ? positionData.page : undefined;
        await createAnnotation(body, selectionText, positionData, docPage);
    };

    const handleHighlightClick = useCallback(() => {
        openSidebar("annotations", {
            type: "material",
            id: materialId,
            data: material,
        });
    }, [openSidebar, materialId, material]);

    useEffect(() => {
        if (isDesktop) {
            openSidebar("details", {
                type: "material",
                id: materialId,
                data: material,
            });
        }
    }, [materialId, isDesktop, material, openSidebar]);

    return (
        <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden gap-0">
            <div className="flex-1 flex flex-col min-w-0 min-h-0 p-4 md:p-6 gap-3">
                {isMobile && (
                    <button
                        onClick={() => router.back()}
                        className="fixed left-4 top-16 z-50 rounded-full bg-background/80 p-2 shadow-md backdrop-blur print:hidden"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                )}

                {/* Breadcrumbs */}
                {breadcrumbs.length > 0 && !isMobile && (
                    <div className="print:hidden">
                        <Breadcrumbs items={breadcrumbs} />
                    </div>
                )}

                {/* Compact header */}
                <div className="flex items-center justify-between gap-3 print:hidden">
                    <div className="flex items-center gap-3 min-w-0">
                        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => router.back()} title="Back">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="text-lg font-semibold truncate">{title}</h1>
                                <Badge variant="outline" className="capitalize shrink-0 text-xs">
                                    {materialType}
                                </Badge>
                            </div>
                            {fileSize > 0 && (
                                <p className="text-xs text-muted-foreground">{formatFileSize(fileSize)}</p>
                            )}
                        </div>
                    </div>
                    {!isMobile && (
                        <div className="flex items-center gap-2 shrink-0">
                            {!parentMaterialId && (
                                <Button variant="outline" size="sm" asChild>
                                    <Link
                                        href={`${pathname}/attachments`}
                                        className="gap-2 border-violet-200 text-violet-700 hover:bg-violet-50 dark:border-violet-800/50 dark:text-violet-300 dark:hover:bg-violet-950/30"
                                    >
                                        <Paperclip className="h-3.5 w-3.5" />
                                        Attachments
                                        {attachmentCount > 0 && (
                                            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold bg-violet-200 text-violet-700 dark:bg-violet-800 dark:text-violet-200">
                                                {attachmentCount}
                                            </Badge>
                                        )}
                                    </Link>
                                </Button>
                            )}
                            <Button size="sm" asChild>
                                <a href={downloadUrl} target="_blank" className="gap-2">
                                    <Download className="h-3.5 w-3.5" />
                                    Download
                                </a>
                            </Button>
                        </div>
                    )}
                </div>

                {/* Viewer */}
                <div ref={viewerContainerRef} className="relative flex-1 min-h-0 overflow-auto rounded-lg border print:border-none print:overflow-visible print:block">
                    {viewerType === "pdf" && <PdfViewer fileKey={fileKey} materialId={materialId} annotations={threads} onAnnotationClick={handleHighlightClick} />}
                    {viewerType === "markdown" && <MarkdownViewer fileKey={fileKey} materialId={materialId} />}
                    {viewerType === "image" && <ImageViewer fileKey={fileKey} materialId={materialId} fileName={fileName} />}
                    {viewerType === "video" && <VideoPlayer fileKey={fileKey} materialId={materialId} material={material} />}
                    {viewerType === "code" && <CodeViewer fileKey={fileKey} materialId={materialId} fileName={fileName} />}
                    {viewerType === "office" && <OfficeViewer fileKey={fileKey} materialId={materialId} fileName={fileName} mimeType={mimeType} />}
                    {viewerType === "epub" && <EpubViewer fileKey={fileKey} materialId={materialId} />}
                    {viewerType === "djvu" && <DjvuViewer fileKey={fileKey} materialId={materialId} />}
                    {viewerType === "generic" && <GenericViewer fileName={fileName} fileSize={fileSize} mimeType={mimeType} materialId={materialId} />}
                    <AnnotationSelectionTooltip
                        containerRef={viewerContainerRef}
                        onSubmit={handleAnnotationSubmit}
                    />
                </div>
            </div>

            {isDesktop && (
                <div className="sticky top-0 h-[calc(100vh-3.5rem)] w-80 shrink-0 border-l bg-background print:hidden">
                    <SharedSidebar />
                </div>
            )}
            {isMobile && <div className="print:hidden"><ViewerFab materialId={materialId} materialTitle={title} directoryId={directoryId} attachmentCount={attachmentCount} isAttachment={!!parentMaterialId} /></div>}
        </div>
    );
}

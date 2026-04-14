"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  MoreHorizontal,
  Paperclip,
  Loader2,
  PanelRight,
} from "lucide-react";
import { useIsMobile, useIsDesktop } from "@/hooks/use-media-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  formatFileSize,
  getFileExtension,
  getFileBadgeColor,
  getFileBadgeLabel,
} from "@/lib/file-utils";
import { useUIStore } from "@/lib/stores";
// useUIStore provides: sidebarOpen, openSidebar, closeSidebar
import { apiFetch } from "@/lib/api-client";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// --- Dynamic Viewer Imports ---
// This prevents large libraries (like react-pdf, mermaid, monaco) from being compiled
// simultaneously when only one is needed, drastically reducing dev memory pressure.

const PdfViewer = dynamic(
  () => import("@/components/viewers/pdf-viewer").then((mod) => mod.PdfViewer),
  {
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
    ssr: false,
  },
);

const MarkdownViewer = dynamic(
  () =>
    import("@/components/viewers/markdown-viewer").then(
      (mod) => mod.MarkdownViewer,
    ),
  {
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
    ssr: false,
  },
);

const ImageViewer = dynamic(
  () =>
    import("@/components/viewers/image-viewer").then((mod) => mod.ImageViewer),
  {
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
    ssr: false,
  },
);

const VideoPlayer = dynamic(
  () =>
    import("@/components/viewers/video-player").then((mod) => mod.VideoPlayer),
  {
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
    ssr: false,
  },
);

const AudioPlayer = dynamic(
  () =>
    import("@/components/viewers/audio-player").then((mod) => mod.AudioPlayer),
  {
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
    ssr: false,
  },
);

const CodeViewer = dynamic(
  () =>
    import("@/components/viewers/code-viewer").then((mod) => mod.CodeViewer),
  {
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
    ssr: false,
  },
);

const CsvViewer = dynamic(
  () => import("@/components/viewers/csv-viewer").then((mod) => mod.CsvViewer),
  {
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
    ssr: false,
  },
);

const OfficeViewer = dynamic(
  () =>
    import("@/components/viewers/office-viewer").then(
      (mod) => mod.OfficeViewer,
    ),
  {
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
    ssr: false,
  },
);

const EpubViewer = dynamic(
  () =>
    import("@/components/viewers/epub-viewer").then((mod) => mod.EpubViewer),
  {
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
    ssr: false,
  },
);

const DjvuViewer = dynamic(
  () =>
    import("@/components/viewers/djvu-viewer").then((mod) => mod.DjvuViewer),
  {
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
    ssr: false,
  },
);

const GenericViewer = dynamic(
  () =>
    import("@/components/viewers/generic-viewer").then(
      (mod) => mod.GenericViewer,
    ),
  {
    loading: () => <Skeleton className="h-full w-full rounded-none" />,
    ssr: false,
  },
);

const EpubViewerOld = EpubViewer; // keep for type tracking if needed
const DjvuViewerOld = DjvuViewer;

import { SharedSidebar } from "@/components/sidebar/shared-sidebar";
import { ViewerFab } from "@/components/browse/viewer-fab";
import { Breadcrumbs } from "@/components/browse/breadcrumbs";
import { AnnotationSelectionTooltip } from "@/components/annotations/annotation-selection-tooltip";
import { useAnnotations, AnnotationsContext } from "@/hooks/use-annotations";
import { useDownload } from "@/hooks/use-download";
import { usePrint } from "@/hooks/use-print";

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
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "audio/ogg": "audio",
  "audio/flac": "audio",
  "audio/aac": "audio",
  "audio/mp3": "audio",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "office",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "office",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "office",
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
  "text/csv": "csv",
  "application/csv": "csv",
};

const CODE_EXTENSIONS = new Set([
  "js",
  "ts",
  "jsx",
  "tsx",
  "py",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "rs",
  "go",
  "rb",
  "php",
  "cs",
  "swift",
  "kt",
  "scala",
  "html",
  "css",
  "scss",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "sql",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "lua",
  "r",
  "m",
  "ml",
  "hs",
  "ex",
  "exs",
  "clj",
  "txt",
  "log",
  "ini",
  "cfg",
  "conf",
  "tex",
  "latex",
]);

// Fallback: map file extensions to viewer types when MIME is unknown
const EXT_TO_VIEWER: Record<string, string> = {
  pdf: "pdf",
  md: "markdown",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  mp4: "video",
  webm: "video",
  ogg: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  m4a: "audio",
  aac: "audio",
  docx: "office",
  xlsx: "office",
  pptx: "office",
  doc: "office",
  xls: "office",
  ppt: "office",
  odt: "office",
  ods: "office",
  epub: "epub",
  djvu: "djvu",
  djv: "djvu",
  csv: "csv",
};

function getViewerType(mimeType: string, fileName: string): string {
  const ext = getFileExtension(fileName);

  // 1. Exact MIME match
  if (MIME_TO_VIEWER[mimeType]) return MIME_TO_VIEWER[mimeType];

  // 2. MIME prefix match
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("text/")) return "code";

  // 3. Force video player for video extensions if mime type is ambiguous (e.g. application/octet-stream)
  if (ext === "mp4" || ext === "webm" || ext === "ogg" || ext === "mov") {
    return "video";
  }

  // 4. File extension fallback (handles octet-stream / unknown MIME)
  if (EXT_TO_VIEWER[ext]) return EXT_TO_VIEWER[ext];
  if (CODE_EXTENSIONS.has(ext)) return "code";

  return "generic";
}

export function MaterialViewer({
  material,
  breadcrumbs = [],
}: MaterialViewerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();
  const {
    openSidebar,
    closeSidebar,
    sidebarOpen,
    setHideFooter,
    materialActionsOpen,
    setMaterialActionsOpen,
  } = useUIStore();
  const viewerContainerRef = useRef<HTMLDivElement>(null);

  // Hide footer and prevent page scroll while previewer is active
  useEffect(() => {
    setHideFooter(true);
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      setHideFooter(false);
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, [setHideFooter]);

  const title = String(material.title ?? "");
  const directoryId = String(material.directory_id ?? "");
  const parentMaterialId = material.parent_material_id
    ? String(material.parent_material_id)
    : null;
  const attachmentCount = Number(material.attachment_count ?? 0);
  const versionInfo = material.current_version_info as Record<
    string,
    unknown
  > | null;
  const fileName = String(versionInfo?.file_name ?? "");
  const fileSize = Number(versionInfo?.file_size ?? 0);
  const mimeType = String(
    versionInfo?.file_mime_type ?? "application/octet-stream",
  );
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

  const annotationsData = useAnnotations(materialId);
  const { createAnnotation, threads } = annotationsData;
  const { downloadMaterial, isDownloading } = useDownload();
  const { print, canPrint } = usePrint({
    viewerType,
    materialId,
    fileName,
    mimeType,
  });

  // Intercept Ctrl+P to print the material instead of the whole page
  useEffect(() => {
    if (!canPrint) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        print();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canPrint, print]);

  const handleAnnotationSubmit = async (
    body: string,
    selectionText: string,
    positionData: Record<string, unknown>,
  ) => {
    const docPage =
      typeof positionData.page === "number" ? positionData.page : undefined;
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
        data: { ...material, __viewerType: viewerType },
      });
    }
  }, [materialId, isDesktop, material, openSidebar, viewerType]);

  return (
    <AnnotationsContext.Provider value={annotationsData}>
      <div className="flex h-[calc(100dvh-7rem)] md:h-[calc(100dvh-3.5rem)] overflow-hidden gap-0">
        <div className="flex-1 flex flex-col min-w-0 min-h-0 p-2 sm:p-4 md:p-6 gap-3">
          {/* Breadcrumbs */}
          {breadcrumbs.length > 0 && !isMobile && (
            <div>
              <Breadcrumbs items={breadcrumbs} />
            </div>
          )}

          {/* Compact header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => router.back()}
                title="Back"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-base sm:text-lg font-semibold truncate">
                    {title}
                  </h1>
                  <span
                    className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${getFileBadgeColor(fileName)}`}
                  >
                    {getFileBadgeLabel(fileName, mimeType)}
                  </span>
                </div>
                {fileSize > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(fileSize)}
                  </p>
                )}
              </div>
            </div>
            {isMobile ? (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => setMaterialActionsOpen(true)}
                aria-label="Document actions"
              >
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            ) : (
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
                        <Badge
                          variant="secondary"
                          className="h-5 px-1.5 text-[10px] font-semibold bg-violet-200 text-violet-700 dark:bg-violet-800 dark:text-violet-200"
                        >
                          {attachmentCount}
                        </Badge>
                      )}
                    </Link>
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => downloadMaterial(materialId)}
                  disabled={isDownloading}
                  className="gap-2"
                >
                  {isDownloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Download
                </Button>
                <Button
                  variant={sidebarOpen ? "secondary" : "outline"}
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  title={sidebarOpen ? "Close inspector" : "Open inspector"}
                  onClick={() => {
                    if (sidebarOpen) {
                      closeSidebar();
                    } else {
                      openSidebar("details", {
                        type: "material",
                        id: materialId,
                        data: { ...material, __viewerType: viewerType },
                      });
                    }
                  }}
                >
                  <PanelRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Viewer */}
          <div
            ref={viewerContainerRef}
            className="relative flex-1 min-h-0 overflow-hidden rounded-lg border"
          >
            {viewerType === "pdf" && (
              <PdfViewer
                fileKey={fileKey}
                materialId={materialId}
                annotations={threads}
                onAnnotationClick={handleHighlightClick}
              />
            )}
            {viewerType === "markdown" && (
              <MarkdownViewer
                fileKey={fileKey}
                materialId={materialId}
                material={material}
                annotations={threads}
                onAnnotationClick={handleHighlightClick}
              />
            )}
            {viewerType === "image" && (
              <ImageViewer
                fileKey={fileKey}
                materialId={materialId}
                fileName={fileName}
              />
            )}
            {viewerType === "video" && (
              <VideoPlayer
                fileKey={fileKey}
                materialId={materialId}
                material={material}
              />
            )}
            {viewerType === "audio" && (
              <AudioPlayer fileKey={fileKey} materialId={materialId} />
            )}
            {viewerType === "code" && (
              <CodeViewer
                fileKey={fileKey}
                materialId={materialId}
                fileName={fileName}
              />
            )}
            {viewerType === "csv" && (
              <CsvViewer
                fileKey={fileKey}
                materialId={materialId}
                fileName={fileName}
              />
            )}
            {viewerType === "office" && (
              <OfficeViewer
                fileKey={fileKey}
                materialId={materialId}
                fileName={fileName}
                mimeType={mimeType}
              />
            )}
            {viewerType === "epub" && (
              <EpubViewer fileKey={fileKey} materialId={materialId} />
            )}
            {viewerType === "djvu" && (
              <DjvuViewer fileKey={fileKey} materialId={materialId} />
            )}
            {viewerType === "generic" && (
              <GenericViewer
                fileName={fileName}
                fileSize={fileSize}
                mimeType={mimeType}
                materialId={materialId}
              />
            )}
            <AnnotationSelectionTooltip
              containerRef={viewerContainerRef}
              onSubmit={handleAnnotationSubmit}
            />
          </div>
        </div>

        {isDesktop ? (
          sidebarOpen && (
            <div className="sticky top-0 h-[calc(100vh-3.5rem)] w-80 shrink-0 border-l bg-background">
              <SharedSidebar />
            </div>
          )
        ) : (
          <SharedSidebar />
        )}
        {isMobile && (
          <ViewerFab
            material={material}
            materialId={materialId}
            materialTitle={title}
            directoryId={directoryId}
            attachmentCount={attachmentCount}
            isAttachment={!!parentMaterialId}
            viewerType={viewerType}
            mimeType={mimeType}
            fileName={fileName}
            open={materialActionsOpen}
            onOpenChange={setMaterialActionsOpen}
          />
        )}
      </div>
    </AnnotationsContext.Provider>
  );
}

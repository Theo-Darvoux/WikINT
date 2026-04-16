"use client";

import { useRef } from "react";
import { FileText, Download, Loader2 } from "lucide-react";
import { formatFileSize } from "@/lib/file-utils";
import { useDownload } from "@/hooks/use-download";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { FullscreenToggle } from "./fullscreen-toggle";
import { ViewerToolbar } from "./viewer-toolbar";

interface GenericViewerProps {
    fileName: string;
    fileSize: number;
    mimeType: string;
    materialId: string;
}

export function GenericViewer({ fileName, fileSize, mimeType, materialId }: GenericViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
    const { downloadMaterial, isDownloading } = useDownload();

    return (
        <div 
            ref={containerRef} 
            className={`relative flex flex-col bg-background min-w-0 w-full ${isFullscreen ? "h-screen" : "h-full"}`}
        >
            <ViewerToolbar 
                right={
                    <FullscreenToggle 
                        isFullscreen={isFullscreen} 
                        onToggle={toggleFullscreen} 
                        disabled={isDownloading}
                    />
                }
            />
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 bg-zinc-200 dark:bg-zinc-800/50">
            <FileText className="h-16 w-16 text-muted-foreground/50" />
            <div className="text-center">
                <p className="font-medium">{fileName}</p>
                <p className="text-sm text-muted-foreground">{mimeType}</p>
                {fileSize > 0 && <p className="text-sm text-muted-foreground">{formatFileSize(fileSize)}</p>}
            </div>
            <button
                onClick={() => downloadMaterial(materialId)}
                disabled={isDownloading}
                className="flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-70"
            >
                {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                    <Download className="h-4 w-4" />
                )}
                Download
            </button>
            </div>
        </div>
    );
}

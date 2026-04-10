"use client";

import { useRef } from "react";
import { Loader2 } from "lucide-react";
import { useDownload } from "@/hooks/use-download";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { FullscreenToggle } from "./fullscreen-toggle";
import { ViewerToolbar } from "./viewer-toolbar";

interface DjvuViewerProps {
    fileKey: string;
    materialId: string;
}

export function DjvuViewer({ materialId }: DjvuViewerProps) {
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
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center text-muted-foreground w-full bg-muted/20">
            <p className="text-lg font-medium mb-2">Offline DjVu Preview</p>
            <p className="max-w-md mb-6">
                Native browser previewing for DjVu files requires WebAssembly desktop parsers which are currently not installed.
            </p>
            <button
                onClick={() => downloadMaterial(materialId)}
                disabled={isDownloading}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 disabled:opacity-70"
            >
                {isDownloading && <Loader2 className="h-4 w-4 animate-spin" />}
                Download DjVu Document
            </button>
            </div>
        </div>
    );
}

"use client";

import { Loader2 } from "lucide-react";
import { useDownload } from "@/hooks/use-download";

interface DjvuViewerProps {
    fileKey: string;
    materialId: string;
}

export function DjvuViewer({ materialId }: DjvuViewerProps) {
    const { downloadMaterial, isDownloading } = useDownload();

    return (
        <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground w-full h-[400px] bg-muted/20 border-2 border-dashed rounded-lg">
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
    );
}

"use client";

import { Loader2 } from "lucide-react";
import { useDownload } from "@/hooks/use-download";
import { ViewerShell } from "./viewer-shell";

interface DjvuViewerProps {
    fileKey: string;
    materialId: string;
}

export function DjvuViewer({ materialId }: DjvuViewerProps) {
    const { downloadMaterial, isDownloading } = useDownload();

    return (
        <ViewerShell loading={false} error={null}>
            <div className="flex h-full flex-col items-center justify-center p-12 text-center text-muted-foreground w-full">
                <p className="text-lg font-medium mb-2 text-foreground">Offline DjVu Preview</p>
                <p className="max-w-md mb-6">
                    Native browser previewing for DjVu files requires WebAssembly desktop parsers which are currently not installed.
                </p>
                <button
                    onClick={() => downloadMaterial(materialId)}
                    disabled={isDownloading}
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 disabled:opacity-70 transition-colors"
                >
                    {isDownloading && <Loader2 className="h-4 w-4 animate-spin" />}
                    Download DjVu Document
                </button>
            </div>
        </ViewerShell>
    );
}

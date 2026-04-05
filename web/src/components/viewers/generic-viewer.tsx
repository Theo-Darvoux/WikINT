"use client";

import { FileText, Download, Loader2 } from "lucide-react";
import { formatFileSize } from "@/lib/file-utils";
import { useDownload } from "@/hooks/use-download";

interface GenericViewerProps {
    fileName: string;
    fileSize: number;
    mimeType: string;
    materialId: string;
}

export function GenericViewer({ fileName, fileSize, mimeType, materialId }: GenericViewerProps) {
    const { downloadMaterial, isDownloading } = useDownload();

    return (
        <div className="flex flex-col items-center justify-center gap-4 py-16">
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
    );
}

"use client";

import { FileText, Download } from "lucide-react";
import { formatFileSize } from "@/lib/file-utils";

interface GenericViewerProps {
    fileName: string;
    fileSize: number;
    mimeType: string;
    materialId: string;
}

export function GenericViewer({ fileName, fileSize, mimeType, materialId }: GenericViewerProps) {
    const downloadUrl = `/api/materials/${materialId}/download`;

    return (
        <div className="flex flex-col items-center justify-center gap-4 py-16">
            <FileText className="h-16 w-16 text-muted-foreground/50" />
            <div className="text-center">
                <p className="font-medium">{fileName}</p>
                <p className="text-sm text-muted-foreground">{mimeType}</p>
                {fileSize > 0 && <p className="text-sm text-muted-foreground">{formatFileSize(fileSize)}</p>}
            </div>
            <a
                href={downloadUrl}
                className="flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
                <Download className="h-4 w-4" />
                Download
            </a>
        </div>
    );
}

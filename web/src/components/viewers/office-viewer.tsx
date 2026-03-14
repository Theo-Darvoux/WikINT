"use client";

import { useEffect, useState } from "react";

interface OfficeViewerProps {
    fileKey: string;
    materialId: string;
    fileName: string;
    mimeType: string;
}

export function OfficeViewer({ materialId, mimeType }: OfficeViewerProps) {
    const [content, setContent] = useState<string>("");
    const [loading, setLoading] = useState(true);

    const downloadUrl = `/api/materials/${materialId}/download`;

    useEffect(() => {
        const loadDocument = async () => {
            try {
                if (mimeType.includes("wordprocessingml")) {
                    const mammoth = await import("mammoth");
                    const response = await fetch(downloadUrl);
                    const arrayBuffer = await response.arrayBuffer();
                    const result = await mammoth.convertToHtml({ arrayBuffer });
                    setContent(result.value);
                } else if (mimeType.includes("spreadsheet") || mimeType === "application/vnd.ms-excel") {
                    const XLSX = await import("xlsx");
                    const response = await fetch(downloadUrl);
                    const arrayBuffer = await response.arrayBuffer();
                    const workbook = XLSX.read(arrayBuffer, { type: "array" });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const html = XLSX.utils.sheet_to_html(firstSheet);
                    setContent(html);
                } else if (
                    mimeType === "application/msword" ||
                    mimeType === "application/vnd.ms-powerpoint" ||
                    mimeType.includes("presentation") ||
                    mimeType.includes("opendocument.text")
                ) {
                    setContent(`
                        <div style="text-align: center; padding: 3rem; color: #6b7280;">
                            <p style="font-size: 1.125rem; font-weight: 500; margin-bottom: 0.5rem;">Offline Preview Unavailable</p>
                            <p>This proprietary or legacy format cannot be natively rendered inside the browser securely. Please download the file to view its contents.</p>
                        </div>
                    `);
                } else {
                    setContent(`<p>Preview not available for this file type. Please download the file.</p>`);
                }
            } catch {
                setContent(`<p>Failed to load document preview.</p>`);
            } finally {
                setLoading(false);
            }
        };
        loadDocument();
    }, [downloadUrl, mimeType]);

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
        );
    }

    return (
        <div
            className="prose prose-sm max-w-none p-6 dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: content }}
        />
    );
}

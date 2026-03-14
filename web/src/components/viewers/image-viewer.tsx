"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface ImageViewerProps {
    fileKey: string;
    materialId: string;
    fileName: string;
}

export function ImageViewer({ materialId, fileName }: ImageViewerProps) {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

    useEffect(() => {
        let objectUrl: string | null = null;
        let cancelled = false;

        queueMicrotask(() => {
            if (cancelled) return;
            setLoading(true);
            setError(null);
            setBlobUrl(null);
        });

        fetch(`${apiBase}/materials/${materialId}/file`, { credentials: "include" })
            .then((res) => {
                if (!res.ok) throw new Error(`Failed to load image (${res.status})`);
                return res.blob();
            })
            .then((blob) => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setBlobUrl(objectUrl);
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load image");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [materialId, apiBase]);

    return (
        <div className="relative flex h-[calc(100vh-10rem)] w-full items-center justify-center bg-muted/20 print:h-auto print:block print:bg-transparent">
            {loading && (
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            )}
            {error && (
                <p className="text-sm text-destructive">{error}</p>
            )}
            {blobUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                    src={blobUrl}
                    alt={fileName}
                    className="max-h-[80vh] max-w-full object-contain"
                />
            )}
        </div>
    );
}

"use client";

import { useEffect, useState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { fetchMaterialBlob } from "@/lib/api-client";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { FullscreenToggle } from "./fullscreen-toggle";
import { ViewerToolbar } from "./viewer-toolbar";

interface ImageViewerProps {
    fileKey: string;
    materialId: string;
    fileName: string;
}

export function ImageViewer({ materialId, fileName }: ImageViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let objectUrl: string | null = null;
        let cancelled = false;

        queueMicrotask(() => {
            if (cancelled) return;
            setLoading(true);
            setError(null);
            setBlobUrl(null);
        });

        fetchMaterialBlob(materialId)
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
    }, [materialId]);

    return (
        <div 
            ref={containerRef} 
            className={`relative flex flex-col bg-background min-w-0 w-full ${isFullscreen ? "h-screen" : "h-full"}`}
        >
            <ViewerToolbar 
                isFullscreen={isFullscreen}
                right={
                    <FullscreenToggle 
                        isFullscreen={isFullscreen} 
                        onToggle={toggleFullscreen} 
                        disabled={loading || !!error}
                    />
                }
            />
            <div className={`relative flex flex-1 w-full items-center justify-center bg-muted/20 ${isFullscreen ? "" : "h-[calc(100vh-10rem)]"}`}>
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
                        className={`${isFullscreen ? "max-h-[90vh]" : "max-h-[80vh]"} max-w-full object-contain`}
                    />
                )}
            </div>
        </div>
    );
}

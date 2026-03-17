"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";

interface EpubViewerProps {
    fileKey: string;
    materialId: string;
}

export function EpubViewer({ materialId }: EpubViewerProps) {
    const viewerRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        let book: { destroy: () => void; renderTo: (el: HTMLElement, opts: Record<string, string>) => { display: () => Promise<void> } } | null = null;
        let rendition: { display: () => Promise<void> } | null = null;

        const loadEpub = async () => {
            try {
                // Ensure epub.js is loaded
                if (!(window as unknown as Record<string, unknown>).ePub) {
                    await new Promise<void>((resolve, reject) => {
                        const script = document.createElement("script");
                        script.src = "https://cdnjs.cloudflare.com/ajax/libs/epub.js/0.3.90/epub.min.js";
                        script.async = true;
                        script.onload = () => resolve();
                        script.onerror = () => reject(new Error("Failed to load generic Epub engine"));
                        document.head.appendChild(script);
                    });
                }

                if (!isMounted) return;

                const response = await apiRequest(`/materials/${materialId}/file`);
                const arrayBuffer = await response.arrayBuffer();

                if (!viewerRef.current || !isMounted) return;

                // Load book string
                book = (window as unknown as Record<string, (buf: ArrayBuffer) => typeof book>).ePub(arrayBuffer);

                rendition = book!.renderTo(viewerRef.current, {
                    width: "100%",
                    height: "100%",
                    spread: "none"
                });

                await rendition.display();
                if (isMounted) setLoading(false);
            } catch (err: unknown) {
                if (isMounted) {
                    setError(err instanceof Error ? err.message : "Failed to load EPUB");
                    setLoading(false);
                }
            }
        };

        loadEpub();

        return () => {
            isMounted = false;
            if (book) {
                book.destroy();
            }
        };
    }, [materialId]);

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                <p className="text-lg font-medium mb-2">Error</p>
                <p>{error}</p>
            </div>
        );
    }

    return (
        <div className="relative flex h-[800px] w-full flex-col bg-muted/20">
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
            )}
            <div ref={viewerRef} className="h-full w-full overflow-hidden" />
        </div>
    );
}

"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-media-query";

interface VideoPlayerProps {
    fileKey: string;
    materialId: string;
    material: Record<string, unknown>;
}

export function VideoPlayer({ materialId, material }: VideoPlayerProps) {
    const isMobile = useIsMobile();
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

    const metadata = material.metadata as Record<string, unknown> | null;
    const embedUrl = metadata?.video_url as string | undefined;

    useEffect(() => {
        if (embedUrl) { queueMicrotask(() => setLoading(false)); return; }
        let objectUrl: string | null = null;
        let cancelled = false;

        queueMicrotask(() => {
            if (cancelled) return;
            setLoading(true);
            setBlobUrl(null);
        });

        fetch(`${apiBase}/materials/${materialId}/file`, { credentials: "include" })
            .then((res) => res.blob())
            .then((blob) => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setBlobUrl(objectUrl);
            })
            .catch(console.error)
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [materialId, apiBase, embedUrl]);

    if (embedUrl) {
        return (
            <div className="aspect-video">
                <iframe
                    src={embedUrl}
                    className="h-full w-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="Video Player"
                />
            </div>
        );
    }

    return (
        <div className="aspect-video bg-black flex items-center justify-center">
            {loading && <Loader2 className="h-8 w-8 animate-spin text-white" />}
            {blobUrl && (
                <video
                    src={blobUrl}
                    controls
                    className="h-full w-full"
                    playsInline={isMobile}
                >
                    Your browser does not support the video tag.
                </video>
            )}
        </div>
    );
}

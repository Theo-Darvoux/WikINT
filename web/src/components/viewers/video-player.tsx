"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-media-query";
import { API_BASE } from "@/lib/api-client";
import { getAccessToken } from "@/lib/auth-tokens";

interface VideoPlayerProps {
    fileKey: string;
    materialId: string;
    material: Record<string, unknown>;
}

export function VideoPlayer({ materialId, material }: VideoPlayerProps) {
    const isMobile = useIsMobile();
    const [loading, setLoading] = useState(true);

    const metadata = material.metadata as Record<string, unknown> | null;
    const embedUrl = metadata?.video_url as string | undefined;

    const token = getAccessToken();
    const streamUrl = token 
        ? `${API_BASE}/materials/${materialId}/file?token=${encodeURIComponent(token)}`
        : `${API_BASE}/materials/${materialId}/file`;

    if (embedUrl) {
        return (
            <div className="aspect-video">
                <iframe
                    src={embedUrl}
                    className="h-full w-full border-0 rounded-lg"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="Video Player"
                />
            </div>
        );
    }

    return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-black/5 p-4 dark:bg-white/5">
            <div className="relative aspect-video w-full max-w-4xl overflow-hidden rounded-xl bg-black shadow-2xl">
                {loading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                        <Loader2 className="h-8 w-8 animate-spin text-white" />
                    </div>
                )}
                <video
                    src={streamUrl}
                    controls
                    className="h-full w-full"
                    onLoadedData={() => setLoading(false)}
                    onError={() => setLoading(false)}
                    playsInline={isMobile}
                >
                    Your browser does not support the video tag.
                </video>
            </div>
        </div>
    );
}

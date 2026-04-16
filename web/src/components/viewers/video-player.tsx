"use client";

import { useState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-media-query";
import { API_BASE } from "@/lib/api-client";
import { getAccessToken } from "@/lib/auth-tokens";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { FullscreenToggle } from "./fullscreen-toggle";
import { ViewerToolbar } from "./viewer-toolbar";

interface VideoPlayerProps {
    fileKey: string;
    materialId: string;
    material: Record<string, unknown>;
}

export function VideoPlayer({ materialId, material }: VideoPlayerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
    const isMobile = useIsMobile();
    const [loading, setLoading] = useState(true);

    const metadata = material.metadata as Record<string, unknown> | null;
    const embedUrl = metadata?.video_url as string | undefined;

    const token = getAccessToken();
    const streamUrl = token 
        ? `${API_BASE}/materials/${materialId}/file?token=${encodeURIComponent(token)}`
        : `${API_BASE}/materials/${materialId}/file`;

    return (
        <div 
            ref={containerRef} 
            className={`relative flex flex-col bg-background min-w-0 w-full ${isFullscreen ? "h-screen" : "h-full"}`}
        >
            <ViewerToolbar 
                right={
                    <FullscreenToggle 
                        isFullscreen={isFullscreen} 
                        onToggle={toggleFullscreen} 
                        disabled={loading && !embedUrl}
                    />
                }
            />
            <div className={`flex flex-1 w-full flex-col items-center justify-center bg-zinc-200 dark:bg-zinc-800/50 p-4 ${isFullscreen ? "min-h-0" : ""}`}>
                {embedUrl ? (
                    <div className="aspect-video w-full max-w-5xl">
                        <iframe
                            src={embedUrl}
                            className="h-full w-full border-0 rounded-lg shadow-2xl"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            title="Video Player"
                        />
                    </div>
                ) : (
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
                )}
            </div>
        </div>
    );
}

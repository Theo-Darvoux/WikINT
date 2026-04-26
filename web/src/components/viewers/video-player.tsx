"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-media-query";
import { API_BASE } from "@/lib/api-client";
import { getAccessToken } from "@/lib/auth-tokens";
import { ViewerShell } from "./viewer-shell";
import { useTranslations } from "next-intl";

interface VideoPlayerProps {
    fileKey: string;
    materialId: string;
    material: Record<string, unknown>;
}

export function VideoPlayer({ materialId, material, fileKey }: VideoPlayerProps) {
    const t = useTranslations("Viewers");
    const isMobile = useIsMobile();
    const [loading, setLoading] = useState(true);
 
    const metadata = material.metadata as Record<string, unknown> | null;
    const embedUrl = metadata?.video_url as string | undefined;
 
    const token = getAccessToken();
    const streamUrl = token 
        ? `${API_BASE}/materials/${materialId}/file?token=${encodeURIComponent(token)}&v=${fileKey}`
        : `${API_BASE}/materials/${materialId}/file?v=${fileKey}`;
 
    return (
        <ViewerShell loading={false} error={null}>
            <div className="flex h-full w-full items-center justify-center">
                {embedUrl ? (
                    <div className="h-full w-full">
                        <iframe
                            src={embedUrl}
                            className="h-full w-full border-0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            title={t("videoTitle")}
                        />
                    </div>
                ) : (
                    <div className="relative h-full w-full bg-black">
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
                            {t("videoNotSupported")}
                        </video>
                    </div>
                )}
            </div>
        </ViewerShell>
    );
}

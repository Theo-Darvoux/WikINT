"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Loader2, ImageOff } from "lucide-react";

interface AsyncMaterialImageProps {
    src: string;
    alt?: string;
    material?: Record<string, unknown>;
    className?: string;
}

// Simple in-memory cache to prevent duplicate requests for the same directory/material
// when rendering multiple images in the same markdown file.
const fetchCache = new Map<string, Promise<unknown>>();

function cachedApiFetch<T>(url: string): Promise<T> {
    if (!fetchCache.has(url)) {
        const promise = apiFetch<T>(url).catch((err) => {
            fetchCache.delete(url); // Don't cache errors aggressively
            throw err;
        });
        fetchCache.set(url, promise);
    }
    return fetchCache.get(url)! as Promise<T>;
}

export function AsyncMaterialImage({ src, alt, material, className }: AsyncMaterialImageProps) {
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;

        async function resolveAndLoad() {
            try {
                // 1. Check if src is already an absolute URL
                if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
                    if (mounted) {
                        setUrl(src);
                        setLoading(false);
                    }
                    return;
                }

                // If no material context is provided, we can't reliably resolve relative paths
                if (!material) {
                    if (mounted) setError(true);
                    return;
                }

                // Handle wiki-links like "image.png" or "attachments/image.png"
                // Extract just the filename to be robust against standard markdown relativity
                const fileName = src.split("/").pop() || src;

                let targetMaterialId: string | null = null;

                // Step 1: Try attachments of the current material
                if (material.id) {
                    try {
                        const attachments = await cachedApiFetch<Record<string, unknown>[]>(`/materials/${material.id}/attachments`);
                        const matched = attachments.find(
                            (m) => m.title === fileName || (m.current_version_info as Record<string, unknown> | undefined)?.file_name === fileName
                        );
                        if (matched) targetMaterialId = matched.id as string;
                    } catch {
                        // ignore
                    }
                }

                // Step 2: Try siblings in the same directory
                if (!targetMaterialId && material.directory_id) {
                    try {
                        const children = await cachedApiFetch<{ materials: Record<string, unknown>[] }>(
                            `/directories/${material.directory_id}/children`
                        );
                        const matched = children.materials?.find(
                            (m) => m.title === fileName || (m.current_version_info as Record<string, unknown> | undefined)?.file_name === fileName
                        );
                        if (matched) targetMaterialId = matched.id as string;
                    } catch {
                        // ignore
                    }
                }

                // Step 3: Try global search as a fallback
                if (!targetMaterialId) {
                    try {
                        const searchRes = await cachedApiFetch<{ materials: Record<string, unknown>[] }>(
                            `/search?query=${encodeURIComponent(fileName)}&limit=10`
                        );
                        const matched = searchRes.materials?.find(
                            (m) => m.title === fileName || (m.current_version_info as Record<string, unknown> | undefined)?.file_name === fileName
                        );
                        if (matched) targetMaterialId = matched.id as string;
                    } catch {
                        // ignore
                    }
                }

                // If found, fetch the presigned inline URL
                if (targetMaterialId && mounted) {
                    const inlineRes = await cachedApiFetch<{ url: string }>(`/materials/${targetMaterialId}/inline`);
                    setUrl(inlineRes.url);
                } else {
                    if (mounted) setError(true);
                }
            } catch {
                if (mounted) setError(true);
            } finally {
                if (mounted) setLoading(false);
            }
        }

        resolveAndLoad();

        return () => {
            mounted = false;
        };
    }, [src, material]);

    if (loading) {
        return (
            <span className="my-4 flex items-center justify-center rounded-md bg-muted p-8 animate-pulse border border-border">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Resolving image &apos;{src}&apos;...</span>
            </span>
        );
    }

    if (error || !url) {
        return (
            <span className="my-4 flex items-center justify-center rounded-md bg-destructive/10 p-4 border border-destructive/20 text-destructive text-sm" title={src}>
                <ImageOff className="mr-2 h-5 w-5" />
                Failed to load image: {src}
            </span>
        );
    }

    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={alt || src} className={className} loading="lazy" />;
}

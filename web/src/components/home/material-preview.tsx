"use client";

import { useEffect, useState, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { getFileTypeStyle } from "./file-type-display";
import type { MaterialDetail } from "./types";
import { Loader2 } from "lucide-react";
import { MarkdownRenderer } from "../viewers/markdown-renderer";

interface MaterialPreviewProps {
  material: MaterialDetail;
  className?: string;
}

export function MaterialPreview({ material, className }: MaterialPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [isServerThumbnail, setIsServerThumbnail] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const versionInfo = material.current_version_info;
  const fileName = versionInfo?.file_name ?? "";
  const mimeType = versionInfo?.file_mime_type ?? "";

  const isImage = mimeType.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fileName);
  const isVideo = mimeType.startsWith("video/") || /\.(mp4|webm|avi|mkv|mov)$/i.test(fileName);
  const isMarkdown = mimeType === "text/markdown" || /\.(md|markdown)$/i.test(fileName);
  const isText = (mimeType.startsWith("text/") || /\.(txt|py|js|ts|json)$/i.test(fileName)) && !isMarkdown;
  const isPDF = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  const isOffice = mimeType.includes("ms-") || mimeType.includes("officedocument") || /\.(docx|xlsx|pptx)$/i.test(fileName);

  // We should fetch if it's media (for native rendering) or if we want a text excerpt
  // But now we prioritize the server-side thumbnail for everything.
  const shouldFetchThumbnail = true;

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    async function fetchPreview() {
      try {
        // 1. Try fetching a dedicated thumbnail first (fastest, most compatible)
        try {
          const thumbData = await apiFetch<{ url: string }>(`/materials/${material.id}/thumbnail`);
          if (mounted && thumbData.url) {
            setUrl(thumbData.url);
            setIsServerThumbnail(true);
            setLoading(false);
            return;
          }
        } catch (e) {
          // Thumbnail not available yet, fall back to native resolution for media/text
          console.debug("No server thumbnail available, falling back to inline source.");
        }

        if (!mounted) return;

        // 2. Fallback: Fetch direct inline URL for native client-side previews
        const isMediaOrText = isImage || isVideo || isText || isMarkdown;
        if (!isMediaOrText) {
          setLoading(false);
          return;
        }

        const data = await apiFetch<{ url: string }>(`/materials/${material.id}/inline`);
        if (!mounted) return;
        
        setUrl(data.url);
        setIsServerThumbnail(false);

        // If it's a text or markdown file, fetch a snippet
        if ((isText || isMarkdown) && data.url) {
           try {
             const res = await fetch(data.url);
             const text = await res.text();
             if (mounted) {
               setTextPreview(text.slice(0, 1000));
             }
           } catch (e) {
             console.error("Failed to fetch text preview:", e);
           }
        }
      } catch (err) {
        if (mounted) {
          setError(true);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    const timer = setTimeout(fetchPreview, 100);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [material.id, isText, isImage, isVideo, isMarkdown]);

  const { gradient, iconColorClass, Icon } = getFileTypeStyle(fileName, mimeType);

  const handleVideoLoaded = () => {
    if (videoRef.current) {
        const duration = videoRef.current.duration;
        const seekTime = Math.min(duration * 0.1, 2);
        videoRef.current.currentTime = Math.max(seekTime, 0.5);
        setVideoLoaded(true);
    }
  };

  const showContent = url && (isServerThumbnail || isImage || (isVideo && videoLoaded) || (isText && textPreview) || (isMarkdown && textPreview));

  return (
    <div
      className={cn(
        "relative w-full h-full flex items-center justify-center overflow-hidden transition-all duration-700 bg-linear-to-br",
        gradient,
        className
      )}
    >
      {/* ── Decorative "Paper Stack" for Documents ────────────────────────── */}
      {(isPDF || isOffice) && !isServerThumbnail && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute h-24 w-18 bg-white/10 rounded-sm rotate-6 translate-x-1" />
          <div className="absolute h-24 w-18 bg-white/5 rounded-sm -rotate-3 -translate-x-1" />
        </div>
      )}

      {/* ── Background Icon ──────────────────────────────────────────────── */}
      <Icon
        className={cn(
          "h-12 w-12 transition-all duration-500 drop-shadow-xl z-10",
          iconColorClass,
          showContent ? "opacity-0 scale-75 blur-sm" : "opacity-90 scale-100"
        )}
      />

      {/* ── Server Thumbnail (Priority) OR Client Image ──────────────────── */}
      {url && (isServerThumbnail || isImage) && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url}
          alt={material.title}
          className="absolute inset-0 h-full w-full object-cover animate-in fade-in zoom-in-95 duration-700"
          loading="lazy"
        />
      )}

      {/* ── Native Video Preview (Fallback when no thumbnail) ────────────── */}
      {url && !isServerThumbnail && isVideo && (
        <video
          ref={videoRef}
          src={url}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedData={handleVideoLoaded}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-700",
            videoLoaded ? "opacity-100" : "opacity-0"
          )}
          onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => {
              e.currentTarget.pause();
              const duration = e.currentTarget.duration;
              const seekTime = Math.min(duration * 0.1, 2);
              e.currentTarget.currentTime = Math.max(seekTime, 0.5);
          }}
        />
      )}

      {/* ── Text Snippet Preview (Code/Txt) ─────────────────────────── */}
      {!isServerThumbnail && isText && textPreview && (
        <div className="absolute inset-0 p-4 font-mono text-[10px] leading-relaxed text-white/80 overflow-hidden select-none animate-in fade-in slide-in-from-bottom-2 duration-700 bg-black/5">
          <div className="line-clamp-10 whitespace-pre-wrap opacity-60">
            {textPreview}
          </div>
          <div className="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-black/20 to-transparent" />
        </div>
      )}

      {/* ── Hifi Markdown Preview Card ───────────────────────────────── */}
      {!isServerThumbnail && isMarkdown && textPreview && (
        <div className="absolute inset-0 p-3 overflow-hidden select-none animate-in fade-in slide-in-from-bottom-2 duration-700 origin-top">
           <div className="scale-[0.55] origin-top opacity-60 group-hover:opacity-100 group-hover:scale-[0.58] transition-all duration-500">
             <MarkdownRenderer 
               content={textPreview} 
               previewMode={true}
               className="text-white prose-invert"
             />
           </div>
        </div>
      )}

      {/* ── Loading Overlay ─────────────────────────────────────────────── */}
      {loading && !url && !textPreview && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/5 backdrop-blur-[1px]">
          <Loader2 className="h-6 w-6 animate-spin text-white/40" />
        </div>
      )}
      
      {/* ── Hover Shine Effect ──────────────────────────────────────────── */}
      <div className="absolute inset-0 bg-linear-to-tr from-white/0 via-white/5 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
    </div>
  );
}

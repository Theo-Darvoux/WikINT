"use client";

import { useEffect, useState, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { getFileTypeStyle } from "./file-type-display";
import type { MaterialDetail } from "./types";
import { Loader2 } from "lucide-react";
import { MarkdownRenderer } from "../viewers/markdown-renderer";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Reuse the same worker as pdf-viewer.tsx
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface MaterialPreviewProps {
  material: MaterialDetail;
  className?: string;
}

/** Whether the thumbnail API returned a real generated WebP or a raw-file fallback. */
type ThumbnailType = "webp" | "fallback" | null;

export function MaterialPreview({ material, className }: MaterialPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [thumbnailType, setThumbnailType] = useState<ThumbnailType>(null);
  const [loading, setLoading] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [pdfReady, setPdfReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(300);
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

  // Track container width for react-pdf Page sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width || 300);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth || 300);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setPdfReady(false);

    async function fetchPreview() {
      try {
        // 1. Try the /thumbnail endpoint first.
        //    It returns { url, thumbnail_type: "webp" | "fallback" }.
        try {
          const thumbData = await apiFetch<{ url: string; thumbnail_type: ThumbnailType }>(
            `/materials/${material.id}/thumbnail`
          );
          if (mounted && thumbData.url) {
            setUrl(thumbData.url);
            setThumbnailType(thumbData.thumbnail_type ?? "webp");
            setLoading(false);
            return;
          }
        } catch {
          // Thumbnail not available — fall through to inline fallback
          console.debug("No server thumbnail available, falling back to inline source.");
        }

        if (!mounted) return;

        // 2. Fallback: fetch direct inline URL for native client-side rendering
        const isMediaOrText = isImage || isVideo || isText || isMarkdown;
        if (!isMediaOrText) {
          setLoading(false);
          return;
        }

        const data = await apiFetch<{ url: string }>(`/materials/${material.id}/inline`);
        if (!mounted) return;

        setUrl(data.url);
        setThumbnailType(null);  // plain inline URL

        // Fetch text snippet for text/markdown files
        if ((isText || isMarkdown) && data.url) {
          try {
            const res = await fetch(data.url);
            const text = await res.text();
            if (mounted) setTextPreview(text.slice(0, 1000));
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    }

    const timer = setTimeout(fetchPreview, 100);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [material.id, isText, isImage, isVideo, isMarkdown, isPDF]);

  const { gradient, iconColorClass, Icon } = getFileTypeStyle(fileName, mimeType);

  const handleVideoLoaded = () => {
    if (videoRef.current) {
      const duration = videoRef.current.duration;
      const seekTime = Math.min(duration * 0.1, 2);
      videoRef.current.currentTime = Math.max(seekTime, 0.5);
      setVideoLoaded(true);
    }
  };

  // An image URL that should render as <img>:
  //   - "webp"     → real generated WebP thumbnail
  //   - "fallback" → raw image file returned by the server (no WebP generated yet)
  //   - null       → came from the /inline fallback path (isImage must be true)
  // Excludes videos (always <video>) and PDFs (react-pdf or <img> for WebP).
  const showAsImg =
    url &&
    !isVideo &&
    !isPDF &&
    (thumbnailType === "webp" || thumbnailType === "fallback" || (thumbnailType === null && isImage));

  // PDF fallback: raw PDF file returned by server → render first page with react-pdf
  const showAsPdf = url && isPDF && thumbnailType === "fallback";

  // PDF with a real generated WebP thumbnail → just use <img>
  const showPdfWebp = url && isPDF && thumbnailType === "webp";

  const showContent =
    showAsImg ||
    showAsPdf ||
    showPdfWebp ||
    (url && isVideo && videoLoaded) ||
    (url && isText && textPreview) ||
    (url && isMarkdown && textPreview);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full h-full flex items-center justify-center overflow-hidden transition-all duration-700 bg-linear-to-br",
        gradient,
        className
      )}
    >
      {/* ── Decorative "Paper Stack" for Documents (until a preview loads) ── */}
      {(isPDF || isOffice) && !showContent && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute h-24 w-18 bg-white/10 rounded-sm rotate-6 translate-x-1" />
          <div className="absolute h-24 w-18 bg-white/5 rounded-sm -rotate-3 -translate-x-1" />
        </div>
      )}

      {/* ── Background Icon ─────────────────────────────────────────────── */}
      <Icon
        className={cn(
          "h-12 w-12 transition-all duration-500 drop-shadow-xl z-10",
          iconColorClass,
          showContent ? "opacity-0 scale-75 blur-sm" : "opacity-90 scale-100"
        )}
      />

      {/* ── Real WebP thumbnail or native image ─────────────────────────── */}
      {(showAsImg || showPdfWebp) && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url!}
          alt={material.title}
          className="absolute inset-0 h-full w-full object-cover animate-in fade-in zoom-in-95 duration-700"
          loading="lazy"
        />
      )}

      {/* ── PDF first-page preview via react-pdf (fallback URL = raw PDF) ── */}
      {showAsPdf && (
        <div
          className={cn(
            "absolute inset-0 overflow-hidden bg-white pointer-events-none select-none",
            "animate-in fade-in zoom-in-95 duration-700",
            pdfReady ? "opacity-100" : "opacity-0"
          )}
        >
          <Document
            file={url!}
            loading={null}
            onLoadSuccess={() => setPdfReady(true)}
            onLoadError={() => setPdfReady(false)}
            // Suppress known pdfjs noise
            externalLinkTarget="_blank"
          >
            <Page
              pageNumber={1}
              width={containerWidth}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          </Document>
          {/* Gradient overlay so it blends into the card gradient */}
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/30 to-transparent pointer-events-none" />
        </div>
      )}

      {/* ── Native Video Preview ─────────────────────────────────────────── */}
      {url && isVideo && (
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
            if (isFinite(duration) && duration > 0) {
              const seekTime = Math.min(duration * 0.1, 2);
              e.currentTarget.currentTime = Math.max(seekTime, 0.5);
            }
          }}
        />
      )}

      {/* ── Text Snippet Preview (Code/Txt) ─────────────────────────────── */}
      {thumbnailType === null && isText && textPreview && (
        <div className="absolute inset-0 p-4 font-mono text-[10px] leading-relaxed text-white/80 overflow-hidden select-none animate-in fade-in slide-in-from-bottom-2 duration-700 bg-black/5">
          <div className="line-clamp-10 whitespace-pre-wrap opacity-60">
            {textPreview}
          </div>
          <div className="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-black/20 to-transparent" />
        </div>
      )}

      {/* ── Hifi Markdown Preview Card ───────────────────────────────────── */}
      {thumbnailType === null && isMarkdown && textPreview && (
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

      {/* ── Loading Overlay ──────────────────────────────────────────────── */}
      {loading && !url && !textPreview && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/5 backdrop-blur-[1px]">
          <Loader2 className="h-6 w-6 animate-spin text-white/40" />
        </div>
      )}

      {/* ── Hover Shine Effect ───────────────────────────────────────────── */}
      <div className="absolute inset-0 bg-linear-to-tr from-white/0 via-white/5 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
    </div>
  );
}

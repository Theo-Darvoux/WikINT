"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, BookOpen } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import { Skeleton } from "@/components/ui/skeleton";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { ThreadData } from "@/hooks/use-annotations";
import { fetchMaterialBlob } from "@/lib/api-client";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { FullscreenToggle } from "./fullscreen-toggle";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Suppress known "AbortException: TextLayer task cancelled" logs from pdfjs/react-pdf
// which spam the Next.js Turbopack dev overlay during fast zoom or scroll operations
if (typeof window !== "undefined") {
    const originalError = console.error;
    const originalWarn = console.warn;
    const filterArgs = (args: unknown[]) => {
        const msg = args[0];
        if (typeof msg === "string" && (msg.includes("AbortException") || msg.includes("InvalidPDFException"))) return true;
        if (msg instanceof Error && (msg.name === "AbortException" || msg.name === "InvalidPDFException")) return true;
        return false;
    };
    console.error = (...args) => {
        if (filterArgs(args)) return;
        originalError(...args);
    };
    console.warn = (...args) => {
        if (filterArgs(args)) return;
        originalWarn(...args);
    };
}

const ZOOM_STEP = 25;
const MIN_ZOOM = 50;
const MAX_ZOOM = 300;

interface PdfViewerProps {
    fileKey: string;
    materialId: string;
    annotations?: ThreadData[];
    onAnnotationClick?: () => void;
}

interface HighlightRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface PageAnnotation {
    selection_text: string | null;
    page: number | null;
}

function buildHighlights(pageEl: HTMLElement, annotations: PageAnnotation[]): HighlightRect[] {
    const textLayer = pageEl.querySelector(".react-pdf__Page__textContent");
    if (!textLayer) return [];

    const spans = Array.from(textLayer.querySelectorAll("span")).filter(
        s => (s.textContent || "").length > 0
    );
    if (spans.length === 0) return [];

    const pageRect = pageEl.getBoundingClientRect();
    if (pageRect.width === 0) return []; // not laid out yet

    let fullText = "";
    const spanRanges: { start: number; end: number; el: Element }[] = [];
    for (const span of spans) {
        const t = span.textContent || "";
        spanRanges.push({ start: fullText.length, end: fullText.length + t.length, el: span });
        fullText += t;
    }

    const highlights: HighlightRect[] = [];
    for (const ann of annotations) {
        if (!ann.selection_text) continue;
        let searchFrom = 0;
        let idx: number;
        while ((idx = fullText.indexOf(ann.selection_text, searchFrom)) !== -1) {
            const matchEnd = idx + ann.selection_text.length;
            for (const { start, end, el } of spanRanges) {
                if (end <= idx || start >= matchEnd) continue;
                const r = el.getBoundingClientRect();
                if (r.width === 0) continue; // span not laid out
                highlights.push({
                    x: r.left - pageRect.left,
                    y: r.top - pageRect.top,
                    w: r.width,
                    h: r.height,
                });
            }
            searchFrom = matchEnd;
        }
    }
    return highlights;
}

function highlightsEqual(a: HighlightRect[], b: HighlightRect[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (
            Math.abs(a[i].x - b[i].x) > 0.5 ||
            Math.abs(a[i].y - b[i].y) > 0.5 ||
            Math.abs(a[i].w - b[i].w) > 0.5 ||
            Math.abs(a[i].h - b[i].h) > 0.5
        ) {
            return false;
        }
    }
    return true;
}

interface AnnotatedPageProps {
    pageNumber: number;
    width: number;
    annotations: PageAnnotation[];
    onAnnotationClick?: () => void;
}

function AnnotatedPage({ pageNumber, width, annotations, onAnnotationClick }: AnnotatedPageProps) {
    const pageRef = useRef<HTMLDivElement>(null);
    const [highlights, setHighlights] = useState<HighlightRect[]>([]);
    const frameRef = useRef<number>(0);

    // Defer measurement to next paint so layout is complete after DOM mutations
    const scheduleRecalc = useCallback(() => {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => {
            const el = pageRef.current;
            if (!el) return;
            const next = buildHighlights(el, annotations);
            setHighlights(prev => highlightsEqual(prev, next) ? prev : next);
        });
    }, [annotations]);

    // Watch the text layer for DOM changes (zoom causes PDF.js to recreate text layer spans)
    useEffect(() => {
        const el = pageRef.current;
        if (!el) return;
        const observer = new MutationObserver(scheduleRecalc);
        observer.observe(el, { childList: true, subtree: true });
        scheduleRecalc(); // handle already-rendered text layer on first mount
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frameRef.current);
        };
    }, [scheduleRecalc]);

    return (
        <div ref={pageRef} style={{ position: "relative" }}>
            <Page
                pageNumber={pageNumber}
                width={width}
                renderTextLayer
                renderAnnotationLayer={false}
            />
            {highlights.map((h, i) => (
                <div
                    key={i}
                    onClick={onAnnotationClick}
                    style={{
                        position: "absolute",
                        left: h.x,
                        top: h.y,
                        width: h.w,
                        height: h.h,
                        backgroundColor: "rgba(255, 213, 0, 0.4)",
                        mixBlendMode: "multiply",
                        zIndex: 4,
                        cursor: onAnnotationClick ? "pointer" : "default",
                        pointerEvents: onAnnotationClick ? "auto" : "none",
                    }}
                />
            ))}
        </div>
    );
}

function LazyBlock({ estimatedHeight, scrollRootRef, children }: {
    estimatedHeight: number;
    scrollRootRef?: React.RefObject<HTMLElement | null>;
    children: React.ReactNode;
}) {
    const sentinelRef = useRef<HTMLDivElement>(null);
    const [isNear, setIsNear] = useState(false);

    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const rootAttr = scrollRootRef?.current ?? null;
        const io = new IntersectionObserver(
            ([entry]) => setIsNear(entry.isIntersecting),
            { root: rootAttr, rootMargin: "600px 0px" }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [scrollRootRef]);

    return (
        <div ref={sentinelRef} style={isNear ? undefined : { height: estimatedHeight }}>
            {isNear ? children : null}
        </div>
    );
}

export function PdfViewer({ materialId, annotations = [], onAnnotationClick }: PdfViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
    const [zoom, setZoom] = useState(100);
    const [fileBlob, setFileBlob] = useState<Blob | null>(null);
    const [loading, setLoading] = useState(true);
    const [numPages, setNumPages] = useState<number>(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [containerWidth, setContainerWidth] = useState<number>(800);
    const [twoPageView, setTwoPageView] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let objectUrl: string | null = null;
        let cancelled = false;
        Promise.resolve().then(() => {
            if (cancelled) return;
            setLoading(true);
            setNumPages(0);
            setError(null);
        });
        fetchMaterialBlob(materialId)
            .then(blob => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setFileBlob(blob);
            })
            .catch(err => {
                if (!cancelled) setError(err.message ?? "Failed to load PDF");
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [materialId]);

    useEffect(() => {
        const el = scrollRef.current ?? containerRef.current;
        if (!el) return;
        let rafId: number;
        const ro = new ResizeObserver(entries => {
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                const width = entries[0]?.contentRect.width;
                if (width) setContainerWidth(prev => Math.abs(width - prev) > 1 ? width : prev);
            });
        });
        ro.observe(el);
        return () => {
            ro.disconnect();
            cancelAnimationFrame(rafId);
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Zoom keyboard shortcuts
            if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
                e.preventDefault();
                setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP));
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "-") {
                e.preventDefault();
                setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP));
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "0") {
                e.preventDefault();
                setZoom(100);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
        setNumPages(numPages);
    }, []);

    const onDocumentLoadError = useCallback((err: Error) => {
        setError(err.message ?? "Failed to parse PDF");
    }, []);

    // Scroll-based page tracking
    useEffect(() => {
        const scrollEl = scrollRef.current;
        if (!scrollEl || numPages === 0) return;

        const io = new IntersectionObserver(
            (entries) => {
                // Find the entry with the highest intersection ratio near the top
                let best: { page: number; ratio: number; top: number } | null = null;
                for (const entry of entries) {
                    const page = Number((entry.target as HTMLElement).dataset.page);
                    if (!page) continue;
                    if (entry.isIntersecting) {
                        const top = entry.boundingClientRect.top;
                        if (!best || top < best.top) {
                            best = { page, ratio: entry.intersectionRatio, top };
                        }
                    }
                }
                if (best) setCurrentPage(best.page);
            },
            {
                root: scrollEl,
                rootMargin: "0px 0px -80% 0px",
                threshold: 0,
            }
        );

        // Observe all page sentinel divs
        const sentinels = scrollEl.querySelectorAll("[data-page]");
        sentinels.forEach((el) => io.observe(el));

        return () => io.disconnect();
    }, [numPages, zoom, twoPageView]);

    const baseWidth = twoPageView ? (containerWidth - 32 - 16) / 2 : containerWidth - 32;
    const pageWidth = (baseWidth * zoom) / 100;

    const allAnnotations: PageAnnotation[] = annotations.map(t => ({
        selection_text: t.root.selection_text,
        page: t.root.page,
    }));

    return (
        <div ref={containerRef} className={`relative flex flex-col bg-background min-w-0 w-full ${isFullscreen ? "h-screen" : "h-full"}`}>
            <div className="sticky top-0 z-10 flex-none flex items-center justify-between gap-1 rounded-t-lg bg-background/80 px-2 py-1 backdrop-blur border-b">
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setTwoPageView(!twoPageView)}
                        disabled={loading}
                        className={`rounded-md p-2 transition-colors disabled:opacity-40 ${twoPageView ? "bg-zinc-200 dark:bg-zinc-800 text-foreground" : "text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-foreground"}`}
                        title="Toggle two page view"
                    >
                        <BookOpen className="h-4 w-4" />
                    </button>
                </div>
                {/* Page indicator */}
                {numPages > 0 && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                        Page {currentPage} of {numPages}
                    </span>
                )}
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
                        disabled={zoom <= MIN_ZOOM || loading}
                        className="rounded-md p-2 transition-colors text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-foreground disabled:opacity-40"
                        title="Zoom out (Ctrl+-)"
                    >
                        <ZoomOut className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => setZoom(100)}
                        disabled={loading}
                        className="min-w-12 rounded-md px-2 py-1 text-center text-xs font-medium tabular-nums transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-40"
                        title="Reset zoom (Ctrl+0)"
                    >
                        {zoom}%
                    </button>
                    <button
                        onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
                        disabled={zoom >= MAX_ZOOM || loading}
                        className="rounded-md p-2 transition-colors text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-foreground disabled:opacity-40"
                        title="Zoom in (Ctrl++)"
                    >
                        <ZoomIn className="h-4 w-4" />
                    </button>
                    <FullscreenToggle
                        isFullscreen={isFullscreen}
                        onToggle={toggleFullscreen}
                        disabled={loading}
                    />
                </div>
            </div>

            <div
                ref={scrollRef}
                className={`overflow-auto bg-muted/20 flex flex-col ${isFullscreen ? "flex-1" : "flex-1"
                    }`}
            >
                {error && (
                    <div className="flex w-full flex-col items-center justify-center p-8 text-center">
                        <p className="text-sm text-destructive">{error}</p>
                    </div>
                )}
                {loading && !error && (
                    <div className="flex w-full flex-col items-center justify-start p-4 md:py-8">
                        {/* A4 proportioned paper skeleton */}
                        <div className="flex w-full max-w-4xl aspect-[1/1.414] flex-col rounded bg-white p-8 shadow-sm dark:bg-zinc-950/50">
                            <Skeleton className="mb-12 h-10 w-3/4 rounded-md" />
                            <div className="space-y-4">
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-[90%]" />
                                <Skeleton className="h-4 w-[95%]" />
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-[85%]" />
                            </div>
                            <div className="mt-12 space-y-4">
                                <Skeleton className="h-4 w-[92%]" />
                                <Skeleton className="h-4 w-[88%]" />
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-[96%]" />
                            </div>
                        </div>
                    </div>
                )}
                {!loading && !error && fileBlob && (
                    <Document
                        file={fileBlob}
                        onLoadSuccess={onDocumentLoadSuccess}
                        onLoadError={onDocumentLoadError}
                        loading={
                            <div className="flex w-full flex-col items-center justify-start p-4 md:py-8">
                                <div className="flex w-full max-w-4xl aspect-[1/1.414] flex-col rounded bg-white p-8 shadow-sm dark:bg-zinc-950/50">
                                    <Skeleton className="mb-12 h-10 w-3/4 rounded-md" />
                                    <div className="space-y-4">
                                        <Skeleton className="h-4 w-full" />
                                        <Skeleton className="h-4 w-[90%]" />
                                        <Skeleton className="h-4 w-[95%]" />
                                        <Skeleton className="h-4 w-full" />
                                        <Skeleton className="h-4 w-[85%]" />
                                    </div>
                                    <div className="mt-12 space-y-4">
                                        <Skeleton className="h-4 w-[92%]" />
                                        <Skeleton className="h-4 w-[88%]" />
                                        <Skeleton className="h-4 w-full" />
                                        <Skeleton className="h-4 w-[96%]" />
                                    </div>
                                </div>
                            </div>
                        }
                        className="py-4 px-4 w-max mx-auto flex flex-col items-center gap-4"
                    >
                        {twoPageView
                            ? Array.from({ length: Math.ceil(numPages / 2) }, (_, rowIdx) => {
                                const left = rowIdx * 2 + 1;
                                const right = rowIdx * 2 + 2;
                                const leftAnns = allAnnotations.filter(a => a.page === left || a.page == null);
                                const rightAnns = allAnnotations.filter(a => a.page === right || a.page == null);
                                return (
                                    <LazyBlock key={rowIdx} estimatedHeight={pageWidth * 1.414} scrollRootRef={scrollRef}>
                                        <div className="grid grid-cols-2 gap-4 place-items-center">
                                            <div data-page={left}>
                                                <AnnotatedPage pageNumber={left} width={pageWidth} annotations={leftAnns} onAnnotationClick={onAnnotationClick} />
                                            </div>
                                            {right <= numPages && (
                                                <div data-page={right}>
                                                    <AnnotatedPage pageNumber={right} width={pageWidth} annotations={rightAnns} onAnnotationClick={onAnnotationClick} />
                                                </div>
                                            )}
                                        </div>
                                    </LazyBlock>
                                );
                            })
                            : Array.from({ length: numPages }, (_, i) => {
                                const pageNum = i + 1;
                                const pageAnnotations = allAnnotations.filter(a => a.page === pageNum || a.page == null);
                                return (
                                    <div key={pageNum} data-page={pageNum}>
                                        <LazyBlock estimatedHeight={pageWidth * 1.414} scrollRootRef={scrollRef}>
                                            <AnnotatedPage pageNumber={pageNum} width={pageWidth} annotations={pageAnnotations} onAnnotationClick={onAnnotationClick} />
                                        </LazyBlock>
                                    </div>
                                );
                            })
                        }
                    </Document>
                )}
            </div>
        </div>
    );
}

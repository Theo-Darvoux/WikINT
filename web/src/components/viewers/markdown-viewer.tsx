"use client";

import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { fetchMaterialFile } from "@/lib/api-client";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { FullscreenToggle } from "./fullscreen-toggle";
import { ViewerToolbar } from "./viewer-toolbar";
import type { ThreadData } from "@/hooks/use-annotations";
import { MarkdownRenderer } from "./markdown-renderer";
import { registerMarkdownPrint, unregisterMarkdownPrint } from "@/lib/markdown-print-registry";

interface MarkdownViewerProps {
    fileKey: string;
    materialId: string;
    material?: Record<string, unknown>;
    annotations?: ThreadData[];
    onAnnotationClick?: () => void;
}

interface HighlightRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

function buildHighlights(container: HTMLElement, annotations: ThreadData[]): HighlightRect[] {
    const textNodes: { node: Text; start: number; end: number }[] = [];
    let fullText = "";

    function walk(node: Node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || "";
            textNodes.push({
                node: node as Text,
                start: fullText.length,
                end: fullText.length + text.length,
            });
            fullText += text;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            // Skip elements that shouldn't be searched or would break text flow
            const el = node as HTMLElement;
            if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return;
            for (let i = 0; i < node.childNodes.length; i++) {
                walk(node.childNodes[i]);
            }
        }
    }

    walk(container);

    const highlights: HighlightRect[] = [];
    const containerRect = container.getBoundingClientRect();

    for (const thread of annotations) {
        const searchText = thread.root.selection_text;
        if (!searchText) continue;

        let searchFrom = 0;
        let idx: number;
        while ((idx = fullText.indexOf(searchText, searchFrom)) !== -1) {
            const matchEnd = idx + searchText.length;
            const range = document.createRange();

            let startNode: Text | null = null;
            let startOffset = 0;
            let endNode: Text | null = null;
            let endOffset = 0;

            for (const { node, start, end } of textNodes) {
                if (!startNode && end > idx) {
                    startNode = node;
                    startOffset = idx - start;
                }
                if (end >= matchEnd) {
                    endNode = node;
                    endOffset = matchEnd - start;
                    break;
                }
            }

            if (startNode && endNode) {
                try {
                    range.setStart(startNode, startOffset);
                    range.setEnd(endNode, endOffset);

                    const rects = range.getClientRects();
                    for (let i = 0; i < rects.length; i++) {
                        const r = rects[i];
                        highlights.push({
                            x: r.left - containerRect.left + container.scrollLeft,
                            y: r.top - containerRect.top + container.scrollTop,
                            w: r.width,
                            h: r.height,
                        });
                    }
                } catch (e) {
                    console.error("Failed to create range for highlight", e);
                }
            }
            searchFrom = idx + 1;
        }
    }

    return highlights;
}

export function MarkdownViewer({ 
    materialId, 
    material, 
    annotations = [], 
    onAnnotationClick 
}: MarkdownViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const proseRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
    const [content, setContent] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [highlights, setHighlights] = useState<HighlightRect[]>([]);

    useEffect(() => {
        registerMarkdownPrint(materialId, () => proseRef.current?.innerHTML ?? null);
        return () => unregisterMarkdownPrint(materialId);
    }, [materialId]);

    useEffect(() => {
        let cancelled = false;

        const loadContent = () => {
            setLoading(true);
            setError(false);

            fetchMaterialFile(materialId)
                .then((res) => res.text())
                .then((text) => {
                    const parsed = text.replace(/!\[\[(.*?)\]\]/g, "![$1]($1)");
                    if (!cancelled) setContent(parsed);
                })
                .catch(() => {
                    if (!cancelled) setError(true);
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
        };

        loadContent();

        return () => {
            cancelled = true;
        };
    }, [materialId]);

    const rendered = useMemo(
        () =>
            content ? (
                <MarkdownRenderer
                    content={content}
                    materialId={materialId}
                    material={material}
                />
            ) : null,
        [content, materialId, material],
    );

    const updateHighlights = useCallback(() => {
        if (!proseRef.current || !annotations.length) {
            setHighlights([]);
            return;
        }
        const next = buildHighlights(proseRef.current, annotations);
        setHighlights(next);
    }, [annotations]);

    useEffect(() => {
        if (!loading && !error && content) {
            // Small delay to ensure ReactMarkdown has finished its DOM update
            const timer = setTimeout(updateHighlights, 50);
            return () => clearTimeout(timer);
        }
    }, [loading, error, content, updateHighlights]);

    useEffect(() => {
        if (!proseRef.current) return;
        const ro = new ResizeObserver(updateHighlights);
        ro.observe(proseRef.current);
        return () => ro.disconnect();
    }, [updateHighlights]);


    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
                Failed to load markdown content.
            </div>
        );
    }

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
                        disabled={loading || error}
                    />
                }
            />
            <div
                ref={proseRef}
                className={`flex-1 overflow-auto bg-zinc-200 dark:bg-zinc-800/50 prose prose-sm max-w-none p-6 dark:prose-invert
                    prose-img:rounded-lg prose-img:shadow-sm
                    prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                    prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:text-foreground
                    prose-code:before:content-none prose-code:after:content-none prose-code:text-foreground
                    prose-table:border-collapse
                    prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-2
                    prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2
                    prose-headings:scroll-mt-20
                    relative
                    [&_mark]:bg-yellow-200 [&_mark]:text-yellow-900 dark:[&_mark]:bg-yellow-500/20 dark:[&_mark]:text-yellow-200`}
            >
                {rendered}
                
                {/* Highlight Overlays */}
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
                        className="rounded-sm"
                    />
                ))}
            </div>
        </div>
    );
}


"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import Papa from "papaparse";
import { fetchMaterialFile } from "@/lib/api-client";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { usePinchZoom } from "@/hooks/use-pinch-zoom";
import { FullscreenToggle } from "./fullscreen-toggle";
import { ViewerToolbar } from "./viewer-toolbar";
import { ZoomControls } from "./zoom-controls";

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

const MAX_FETCH_BYTES = 10 * 1024 * 1024; // 10 MiB hard cap before parsing
const PAGE_SIZE = 100;

interface CsvViewerProps {
    fileKey: string;
    materialId: string;
    fileName: string;
}

export function CsvViewer({ materialId }: CsvViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
    const tableContainerRef = useRef<HTMLDivElement>(null);
    const { zoom, zoomIn, zoomOut, resetZoom } = usePinchZoom({
        initial: 100,
        min: MIN_ZOOM,
        max: MAX_ZOOM,
        step: ZOOM_STEP,
        targetRef: tableContainerRef,
        handleKeyboard: true,
    });
    const [headers, setHeaders] = useState<string[]>([]);
    const [rows, setRows] = useState<string[][]>([]);
    const [truncated, setTruncated] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(0);

    const [prevMaterialId, setPrevMaterialId] = useState(materialId);
    if (materialId !== prevMaterialId) {
        setPrevMaterialId(materialId);
        setLoading(true);
        setError(null);
        setHeaders([]);
        setRows([]);
        setPage(0);
    }

    useEffect(() => {
        let cancelled = false;

        fetchMaterialFile(materialId)
            .then(async (res) => {
                const contentLength = Number(res.headers.get("content-length") ?? NaN);
                let text: string;
                if (!isNaN(contentLength) && contentLength > MAX_FETCH_BYTES) {
                    // Partial read via streaming
                    const reader = res.body!.getReader();
                    const chunks: BlobPart[] = [];
                    let received = 0;
                    while (received < MAX_FETCH_BYTES) {
                        const { done, value } = await reader.read();
                        if (done || !value) break;
                        chunks.push(value);
                        received += value.byteLength;
                    }
                    reader.cancel();
                    const blob = new Blob(chunks);
                    text = await blob.text();
                    if (!cancelled) setTruncated(true);
                } else {
                    text = await res.text();
                    if (!cancelled && text.length > MAX_FETCH_BYTES) {
                        setTruncated(true);
                        text = text.slice(0, MAX_FETCH_BYTES);
                    }
                }
                return text;
            })
            .then((text) => {
                if (cancelled) return;
                const result = Papa.parse<string[]>(text, {
                    skipEmptyLines: true,
                });
                if (result.errors.length > 0 && result.data.length === 0) {
                    setError("Failed to parse CSV file.");
                    return;
                }
                const [headerRow, ...dataRows] = result.data as string[][];
                setHeaders(headerRow ?? []);
                setRows(dataRows);
            })
            .catch(() => {
                if (!cancelled) setError("Failed to load file.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [materialId]);

    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const pageRows = useMemo(
        () => rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
        [rows, page],
    );

    const goToPage = (p: number) => {
        setPage(p);
        tableContainerRef.current?.scrollTo({ top: 0 });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center p-8 text-sm text-destructive">
                {error}
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
                left={
                    <span className="text-xs font-medium text-muted-foreground">
                        {rows.length.toLocaleString()} rows · {headers.length} columns
                    </span>
                }
                right={
                    <>
                        <ZoomControls
                            zoom={zoom}
                            onZoomIn={zoomIn}
                            onZoomOut={zoomOut}
                            onReset={resetZoom}
                            min={MIN_ZOOM}
                            max={MAX_ZOOM}
                            disabled={loading}
                        />
                        <FullscreenToggle 
                            isFullscreen={isFullscreen} 
                            onToggle={toggleFullscreen} 
                            disabled={loading}
                        />
                    </>
                }
            />
            <div className="flex h-full flex-col min-h-0">
                {truncated && (
                    <div className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                        <span>⚠ File exceeds 10 MiB — only the first {rows.length.toLocaleString()} rows are shown. Download to view the complete file.</span>
                    </div>
                )}

                {/* Table */}
                <div
                    ref={tableContainerRef}
                    className="flex-1 overflow-auto bg-zinc-200 dark:bg-zinc-800/50"
                    style={{ fontSize: `${zoom}%`, touchAction: "pan-x pan-y" }}
                >
                    <table className="w-full border-collapse text-sm">
                        <thead className="sticky top-0 z-10 bg-muted">
                            <tr>
                                <th className="border-b border-r px-2 py-1.5 text-right font-mono text-xs text-muted-foreground select-none w-[3rem]">
                                    #
                                </th>
                                {headers.map((h, i) => (
                                    <th
                                        key={i}
                                        className="border-b border-r px-3 py-1.5 text-left font-medium text-foreground whitespace-nowrap last:border-r-0"
                                    >
                                        {h || <span className="text-muted-foreground/50 italic">col {i + 1}</span>}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {pageRows.map((row, ri) => {
                                const globalRow = page * PAGE_SIZE + ri + 1;
                                return (
                                    <tr
                                        key={ri}
                                        className="border-b last:border-b-0 hover:bg-muted/40 transition-colors"
                                    >
                                        <td className="border-r px-2 py-1 text-right font-mono text-xs text-muted-foreground select-none">
                                            {globalRow}
                                        </td>
                                        {headers.map((_, ci) => (
                                            <td
                                                key={ci}
                                                className="border-r px-3 py-1 last:border-r-0 max-w-[300px] truncate"
                                                title={row[ci] ?? ""}
                                            >
                                                {row[ci] ?? ""}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                            {pageRows.length === 0 && (
                                <tr>
                                    <td colSpan={headers.length + 1} className="py-8 text-center text-muted-foreground text-sm">
                                        No data rows
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination footer */}
                <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                    <span>
                        Page {page + 1} of {totalPages}
                    </span>
                    {totalPages > 1 && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => goToPage(page - 1)}
                                disabled={page === 0}
                                className="rounded p-0.5 hover:bg-muted disabled:opacity-40"
                                aria-label="Previous page"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => goToPage(page + 1)}
                                disabled={page >= totalPages - 1}
                                className="rounded p-0.5 hover:bg-muted disabled:opacity-40"
                                aria-label="Next page"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

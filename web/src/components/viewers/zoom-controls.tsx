"use client";

import { ZoomIn, ZoomOut } from "lucide-react";

interface ZoomControlsProps {
    zoom: number;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onReset: () => void;
    min?: number;
    max?: number;
    disabled?: boolean;
}

/**
 * Reusable zoom toolbar cluster: ZoomOut | percentage | ZoomIn.
 * Matches the styling used in PdfViewer and can be embedded in any ViewerToolbar.
 */
export function ZoomControls({
    zoom,
    onZoomIn,
    onZoomOut,
    onReset,
    min = 50,
    max = 300,
    disabled = false,
}: ZoomControlsProps) {
    return (
        <>
            <button
                onClick={onZoomOut}
                disabled={disabled || zoom <= min}
                className="rounded-md p-2 transition-colors text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-foreground disabled:opacity-40"
                title="Zoom out (Ctrl+-)"
                aria-label="Zoom out"
            >
                <ZoomOut className="h-4 w-4" />
            </button>
            <button
                onClick={onReset}
                disabled={disabled}
                className="min-w-12 rounded-md px-2 py-1 text-center text-xs font-medium tabular-nums transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-40"
                title="Reset zoom (Ctrl+0)"
                aria-label={`Zoom level ${zoom}%, click to reset`}
            >
                {zoom}%
            </button>
            <button
                onClick={onZoomIn}
                disabled={disabled || zoom >= max}
                className="rounded-md p-2 transition-colors text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-foreground disabled:opacity-40"
                title="Zoom in (Ctrl++)"
                aria-label="Zoom in"
            >
                <ZoomIn className="h-4 w-4" />
            </button>
        </>
    );
}

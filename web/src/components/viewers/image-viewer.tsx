"use client";

import { useRef } from "react";
import { usePinchZoom } from "@/hooks/use-pinch-zoom";
import { useMaterialFile } from "@/hooks/use-material-file";
import { ViewerShell } from "./viewer-shell";
import { ZoomControls } from "./zoom-controls";

const MIN_ZOOM = 25;
const MAX_ZOOM = 500;
const ZOOM_STEP = 25;

interface ImageViewerProps {
    fileKey: string;
    materialId: string;
    fileName: string;
}

export function ImageViewer({ materialId, fileKey, fileName }: ImageViewerProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    const { blobUrl, loading, error } = useMaterialFile({
        materialId,
        fileKey,
        mode: "blob",
    });

    const { zoom, zoomIn, zoomOut, resetZoom } = usePinchZoom({
        initial: 100,
        min: MIN_ZOOM,
        max: MAX_ZOOM,
        step: ZOOM_STEP,
        targetRef: scrollRef,
        handleKeyboard: true,
    });

    return (
        <ViewerShell
            scrollRef={scrollRef}
            loading={loading}
            error={error}
            toolbarRight={
                <ZoomControls
                    zoom={zoom}
                    onZoomIn={zoomIn}
                    onZoomOut={zoomOut}
                    onReset={resetZoom}
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    disabled={loading || !!error}
                />
            }
            className="flex-1"
        >
            <div className="flex min-h-full w-full items-center justify-center p-4">
                {blobUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                        src={blobUrl}
                        alt={fileName}
                        style={{
                            transform: `scale(${zoom / 100})`,
                            transformOrigin: "center center",
                            transition: "transform 0.15s ease",
                        }}
                        className="max-w-full max-h-[85vh] object-contain shadow-md rounded-sm"
                        draggable={false}
                    />
                )}
            </div>
        </ViewerShell>
    );
}

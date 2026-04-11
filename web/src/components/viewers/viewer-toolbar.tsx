"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface ViewerToolbarProps {
    left?: React.ReactNode;
    center?: React.ReactNode;
    right?: React.ReactNode;
    className?: string;
    isFullscreen?: boolean;
}

/**
 * A standard toolbar for file viewers, providing consistent layout 
 * for actions like zoom, page navigation, and fullscreen toggle.
 */
export function ViewerToolbar({
    left,
    center,
    right,
    className,
    isFullscreen,
}: ViewerToolbarProps) {
    return (
        <div className={cn(
            "sticky top-0 z-10 flex-none flex items-center justify-between gap-1 rounded-t-lg bg-background/80 px-2 py-1 backdrop-blur border-b",
            isFullscreen && "pt-[max(4px,env(safe-area-inset-top))] pb-1 sm:pt-1",
            className
        )}>
            <div className="flex items-center gap-1 overflow-hidden">
                {left}
            </div>
            <div className="flex-1 flex justify-center ml-2 mr-2 overflow-hidden px-2">
                {center}
            </div>
            <div className="flex items-center gap-1">
                {right}
            </div>
        </div>
    );
}

"use client";

import { Maximize, Minimize } from "lucide-react";

interface FullscreenToggleProps {
    isFullscreen: boolean;
    onToggle: () => void;
    disabled?: boolean;
    "aria-label"?: string;
}

export function FullscreenToggle({
    isFullscreen,
    onToggle,
    disabled,
    "aria-label": ariaLabel,
}: FullscreenToggleProps) {
    return (
        <button
            onClick={onToggle}
            disabled={disabled}
            className="rounded-md p-2 transition-colors text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-foreground disabled:opacity-40"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={ariaLabel || (isFullscreen ? "Exit fullscreen" : "Fullscreen")}
        >
            {isFullscreen ? (
                <Minimize className="h-4 w-4" />
            ) : (
                <Maximize className="h-4 w-4" />
            )}
        </button>
    );
}

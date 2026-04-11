"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface FloatingPanelProps {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
}

export function FloatingPanel({ open, onClose, children }: FloatingPanelProps) {
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
            <div
                className="absolute inset-0 bg-black/50"
                onClick={onClose}
                aria-hidden="true"
            />
            <div
                ref={panelRef}
                className="relative z-10 flex h-[calc(100%-2rem)] w-[calc(100%-2rem)] flex-col overflow-hidden rounded-lg bg-background shadow-xl md:h-[calc(100%-4rem)] md:w-[calc(100%-4rem)]"
            >
                <button
                    onClick={onClose}
                    className="absolute right-3 top-3 z-10 rounded-md p-1.5 hover:bg-muted"
                    aria-label="Close panel"
                >
                    <X className="h-5 w-5" />
                </button>
                <div className="flex-1 min-h-0 pt-10">
                    {children}
                </div>
            </div>
        </div>
    );
}

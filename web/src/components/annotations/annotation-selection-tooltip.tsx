"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface SelectionPosition {
    x: number;
    y: number;
    text: string;
    positionData: Record<string, unknown>;
}

interface AnnotationSelectionTooltipProps {
    containerRef: React.RefObject<HTMLElement | null>;
    onSubmit: (
        body: string,
        selectionText: string,
        positionData: Record<string, unknown>
    ) => Promise<void>;
}

export function AnnotationSelectionTooltip({
    containerRef,
    onSubmit,
}: AnnotationSelectionTooltipProps) {
    const [selection, setSelection] = useState<SelectionPosition | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [body, setBody] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const tooltipRef = useRef<HTMLDivElement>(null);

    const handleMouseUp = useCallback(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
            if (!showForm) setSelection(null);
            return;
        }

        const range = sel.getRangeAt(0);
        const text = sel.toString().trim();
        if (!text || !containerRef.current?.contains(range.commonAncestorContainer)) {
            if (!showForm) setSelection(null);
            return;
        }

        const rect = range.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();

        setSelection({
            x: rect.left - containerRect.left + rect.width / 2,
            y: rect.top - containerRect.top,
            text,
            positionData: (() => {
                let pageNum: number | undefined;
                let n: Node | null = range.commonAncestorContainer;
                while (n && n !== containerRef.current) {
                    if (n instanceof Element && n.hasAttribute("data-page-number")) {
                        pageNum = parseInt(n.getAttribute("data-page-number") || "0");
                        break;
                    }
                    n = n.parentElement;
                }
                return { page: pageNum, textContent: text };
            })(),
        });
    }, [containerRef, showForm]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        container.addEventListener("mouseup", handleMouseUp);
        return () => container.removeEventListener("mouseup", handleMouseUp);
    }, [containerRef, handleMouseUp]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
                setSelection(null);
                setShowForm(false);
                setBody("");
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSubmit = async () => {
        if (!selection || !body.trim() || submitting) return;
        setSubmitting(true);
        try {
            await onSubmit(body.trim(), selection.text, selection.positionData);
            setSelection(null);
            setShowForm(false);
            setBody("");
        } finally {
            setSubmitting(false);
        }
    };

    if (!selection) return null;

    return (
        <div
            ref={tooltipRef}
            className="absolute z-50"
            style={{
                left: `${selection.x}px`,
                top: `${selection.y - 8}px`,
                transform: "translate(-50%, -100%)",
            }}
        >
            {showForm ? (
                <div className="w-64 rounded-lg border bg-popover p-3 shadow-lg">
                    <p className="mb-2 border-l-2 border-yellow-400/60 pl-2 text-xs italic text-muted-foreground">
                        &ldquo;{selection.text.length > 80
                            ? selection.text.slice(0, 80) + "…"
                            : selection.text}&rdquo;
                    </p>
                    <Textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value.slice(0, 1000))}
                        placeholder="Add your annotation..."
                        className="min-h-[60px] text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSubmit();
                            }
                        }}
                    />
                    <div className="mt-2 flex gap-2">
                        <Button
                            size="sm"
                            onClick={handleSubmit}
                            disabled={submitting || !body.trim()}
                        >
                            Annotate
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setShowForm(false);
                                setBody("");
                            }}
                        >
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : (
                <Button
                    size="sm"
                    variant="secondary"
                    className="flex items-center gap-1.5 shadow-md"
                    onClick={() => setShowForm(true)}
                >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                    Annotate
                </Button>
            )}
        </div>
    );
}

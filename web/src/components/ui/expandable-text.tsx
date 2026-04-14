"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface ExpandableTextProps {
    text: string;
    threshold?: number;
    clampedLines?: number;
    className?: string;
    buttonClassName?: string;
    showMoreLabel?: string;
    showLessLabel?: string;
    as?: "p" | "span" | "div";
}

export function ExpandableText({
    text,
    // threshold = 100, // removed to fix warning
    clampedLines = 2,
    className = "",
    buttonClassName = "",
    showMoreLabel = "Show more",
    showLessLabel = "Show less",
    as: Component = "p",
}: ExpandableTextProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isTruncated, setIsTruncated] = useState(false);
    const textRef = useRef<HTMLParagraphElement & HTMLDivElement & HTMLSpanElement>(null);
    
    useEffect(() => {
        const element = textRef.current;
        if (!element) return;

        const checkTruncation = () => {
            if (element.style.display === "-webkit-box") {
                setIsTruncated(element.scrollHeight > element.clientHeight + 2);
            }
        };

        checkTruncation();
        const resizeObserver = new ResizeObserver(checkTruncation);
        resizeObserver.observe(element);
        
        return () => resizeObserver.disconnect();
    }, [text, clampedLines, isExpanded]);

    return (
        <div className="group/expandable min-w-0 w-full">
            <Component
                ref={textRef}
                className={cn(
                    "whitespace-pre-wrap [overflow-wrap:anywhere]",
                    !isExpanded && "overflow-hidden",
                    className
                )}
                style={!isExpanded ? {
                    display: "-webkit-box",
                    WebkitLineClamp: clampedLines,
                    WebkitBoxOrient: "vertical",
                } : undefined}
            >
                {text}
            </Component>
            {(isTruncated || isExpanded) && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsExpanded(!isExpanded);
                    }}
                    className={cn(
                        "mt-1 block text-[10px] font-bold text-primary hover:underline transition-colors",
                        buttonClassName
                    )}
                >
                    {isExpanded ? showLessLabel : showMoreLabel}
                </button>
            )}
        </div>
    );
}

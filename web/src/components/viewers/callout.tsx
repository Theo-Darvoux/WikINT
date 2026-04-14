"use client";

import React from "react";
import { 
    Info, 
    FileText, 
    CheckSquare, 
    Lightbulb, 
    CheckCircle, 
    HelpCircle, 
    AlertTriangle, 
    XCircle, 
    Skull, 
    Bug, 
    List, 
    Quote,
    ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";

export type CalloutType = 
    | "note" | "abstract" | "summary" | "tldr" | "info" | "todo" 
    | "tip" | "hint" | "important" | "success" | "check" | "done"
    | "question" | "help" | "faq" | "warning" | "caution" | "attention"
    | "failure" | "fail" | "missing" | "danger" | "error" | "bug"
    | "example" | "quote" | "cite";

interface CalloutProps {
    type: CalloutType;
    title?: React.ReactNode;
    children: React.ReactNode;
    collapsible?: boolean;
    defaultOpen?: boolean;
}

const CALLOUT_CONFIG: Record<CalloutType, { icon: React.ElementType; colorClass: string; label: string }> = {
    note: { icon: Info, colorClass: "callout-info", label: "Note" },
    info: { icon: Info, colorClass: "callout-info", label: "Info" },
    todo: { icon: CheckSquare, colorClass: "callout-info", label: "Todo" },
    
    abstract: { icon: FileText, colorClass: "callout-abstract", label: "Abstract" },
    summary: { icon: FileText, colorClass: "callout-abstract", label: "Summary" },
    tldr: { icon: FileText, colorClass: "callout-abstract", label: "TL;DR" },
    
    tip: { icon: Lightbulb, colorClass: "callout-tip", label: "Tip" },
    hint: { icon: Lightbulb, colorClass: "callout-tip", label: "Hint" },
    
    success: { icon: CheckCircle, colorClass: "callout-success", label: "Success" },
    check: { icon: CheckCircle, colorClass: "callout-success", label: "Check" },
    done: { icon: CheckCircle, colorClass: "callout-success", label: "Done" },
    
    question: { icon: HelpCircle, colorClass: "callout-question", label: "Question" },
    help: { icon: HelpCircle, colorClass: "callout-question", label: "Help" },
    faq: { icon: HelpCircle, colorClass: "callout-question", label: "FAQ" },
    
    warning: { icon: AlertTriangle, colorClass: "callout-warning", label: "Warning" },
    caution: { icon: AlertTriangle, colorClass: "callout-warning", label: "Caution" },
    attention: { icon: AlertTriangle, colorClass: "callout-warning", label: "Attention" },
    important: { icon: AlertTriangle, colorClass: "callout-warning", label: "Important" },
    
    failure: { icon: XCircle, colorClass: "callout-failure", label: "Failure" },
    fail: { icon: XCircle, colorClass: "callout-failure", label: "Fail" },
    missing: { icon: XCircle, colorClass: "callout-failure", label: "Missing" },
    
    danger: { icon: Skull, colorClass: "callout-danger", label: "Danger" },
    error: { icon: Skull, colorClass: "callout-danger", label: "Error" },
    bug: { icon: Bug, colorClass: "callout-danger", label: "Bug" },
    
    example: { icon: List, colorClass: "callout-example", label: "Example" },
    
    quote: { icon: Quote, colorClass: "callout-quote", label: "Quote" },
    cite: { icon: Quote, colorClass: "callout-quote", label: "Cite" },
};

export function Callout({ type, title, children, collapsible, defaultOpen }: CalloutProps) {
    const config = CALLOUT_CONFIG[type] || CALLOUT_CONFIG.note;
    const Icon = config.icon;

    const header = (
        <div className="callout-header flex items-center gap-2 font-bold select-none cursor-pointer">
            {collapsible && (
                <ChevronRight className="h-4 w-4 transition-transform duration-200 group-open:rotate-90" />
            )}
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{title || config.label}</span>
        </div>
    );

    const content = (
        <div className="callout-content mt-2 px-1">
            {children}
        </div>
    );

    if (collapsible) {
        return (
            <details 
                className={cn("callout group my-4 rounded-lg border-l-4 p-3 shadow-xs transition-all", config.colorClass)}
                open={defaultOpen}
            >
                <summary className="list-none outline-none [&::-webkit-details-marker]:hidden">
                    {header}
                </summary>
                {content}
            </details>
        );
    }

    return (
        <div className={cn("callout my-4 rounded-lg border-l-4 p-3 shadow-xs transition-all", config.colorClass)}>
            {header}
            {content}
        </div>
    );
}

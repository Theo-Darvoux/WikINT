"use client";

import { ClipboardList, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStagingStore, isExpired } from "@/lib/staging-store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StagingFab() {
    const operations = useStagingStore((s) => s.operations) ?? [];
    const setReviewOpen = useStagingStore((s) => s.setReviewOpen);
    const count = operations.length;
    const expiredCount = operations.filter((s) => isExpired(s)).length;

    if (count === 0) return null;

    return (
        <Button
            onClick={() => setReviewOpen(true)}
            size="lg"
            className={cn(
                "fixed bottom-6 right-6 z-50 gap-2 rounded-full shadow-lg",
                "h-14 px-5 text-base",
                "animate-in fade-in slide-in-from-bottom-4 duration-300",
                expiredCount > 0 && "bg-red-600 hover:bg-red-700",
            )}
        >
            {expiredCount > 0 ? (
                <AlertTriangle className="h-5 w-5" />
            ) : (
                <ClipboardList className="h-5 w-5" />
            )}
            <span>{expiredCount > 0 ? "Expired uploads" : "Review Changes"}</span>
            <Badge
                variant="secondary"
                className="ml-1 h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold"
            >
                {count}
            </Badge>
        </Button>
    );
}

"use client";

import { Star } from "lucide-react";

interface ReputationBadgeProps {
    score: number;
}

export function ReputationBadge({ score }: ReputationBadgeProps) {
    return (
        <div className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-sm font-medium text-yellow-600">
            <Star className="h-3.5 w-3.5" />
            {score}
        </div>
    );
}

"use client";

import { useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";

interface PRVoteButtonsProps {
    prId: string;
    initialScore: number;
    initialUserVote: number;
    disabled?: boolean;
    onAutoApprove?: () => void;
}

export function PRVoteButtons({
    prId,
    initialScore,
    initialUserVote,
    disabled,
    onAutoApprove,
}: PRVoteButtonsProps) {
    const [score, setScore] = useState(initialScore);
    const [userVote, setUserVote] = useState(initialUserVote);

    const handleVote = async (value: number) => {
        if (disabled) return;
        try {
            const newValue = userVote === value ? 0 : value;
            const res = await apiFetch<{
                status: string;
                vote_score: number;
            }>(
                `/pull-requests/${prId}/vote?value=${newValue}`,
                { method: "POST" },
            );
            setScore(res.vote_score);
            setUserVote(newValue);
            if (res.vote_score >= 5) {
                onAutoApprove?.();
            }
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <div className="flex items-center gap-1">
            <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 rounded-full ${userVote === 1 ? "text-green-500 bg-green-500/10" : ""}`}
                disabled={disabled}
                onClick={() => handleVote(1)}
            >
                <ArrowUp className="h-4 w-4" />
            </Button>
            <span
                className={`min-w-[1.5rem] text-center text-sm font-semibold tabular-nums ${
                    score > 0
                        ? "text-green-500"
                        : score < 0
                          ? "text-red-500"
                          : "text-muted-foreground"
                }`}
            >
                {score}
            </span>
            <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 rounded-full ${userVote === -1 ? "text-red-500 bg-red-500/10" : ""}`}
                disabled={disabled}
                onClick={() => handleVote(-1)}
            >
                <ArrowDown className="h-4 w-4" />
            </Button>
        </div>
    );
}

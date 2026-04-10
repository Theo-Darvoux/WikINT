"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { PRCard } from "./pr-card";
import {
    Loader2,
    Send,
    CheckCircle2,
    XCircle,
    Inbox,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface PullRequest {
    id: string;
    type: string;
    status: string;
    title: string;
    description: string | null;
    author: {
        id: string;
        display_name: string;
    } | null;
    created_at: string;
    vote_score: number;
    user_vote: number;
    summary_types?: string[];
    virus_scan_result?: string;
}

type StatusFilter = "open" | "approved" | "rejected" | null;

const TABS: { value: StatusFilter; label: string; icon: React.ElementType }[] =
    [
        { value: "open", label: "Pending", icon: Send },
        { value: "approved", label: "Approved", icon: CheckCircle2 },
        { value: "rejected", label: "Rejected", icon: XCircle },
    ];

const PAGE_SIZE = 20;

export function PRList() {
    const [prs, setPrs] = useState<PullRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [filterStatus, setFilterStatus] = useState<StatusFilter>("open");

    // Lightweight counts for the tab badges (fetched once on mount)
    const [counts, setCounts] = useState<Record<string, number | null>>({
        open: null,
        approved: null,
        rejected: null,
    });

    useEffect(() => {
        let active = true;
        const statuses = ["open", "approved", "rejected"] as const;
        Promise.allSettled(
            statuses.map((s) =>
                apiFetch<PullRequest[]>(
                    `/pull-requests?status=${s}&page=1&limit=1`,
                ).then((d) => d.length),
            ),
        ).then((results) => {
            if (!active) return;
            const next: Record<string, number | null> = {};
            statuses.forEach((s, i) => {
                const r = results[i];
                next[s] = r.status === "fulfilled" ? r.value : null;
            });
            setCounts(next);
        });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        let active = true;
        // Reset loading state via a microtask so the effect body itself
        // does not synchronously call setState (satisfies react-hooks/set-state-in-effect).
        Promise.resolve().then(() => { if (active) setLoading(true); });

        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", String(PAGE_SIZE));
        if (filterStatus) params.set("status", filterStatus);

        apiFetch<PullRequest[]>(`/pull-requests?${params}`)
            .then((data) => {
                if (active) setPrs(data);
            })
            .catch(() => {
                if (active) setPrs([]);
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [page, filterStatus]);

    const switchTab = (status: StatusFilter) => {
        setFilterStatus(status);
        setPage(1);
    };

    const emptyMessage = filterStatus
        ? `No ${filterStatus} contributions`
        : "No contributions yet";

    const EmptyIcon =
        filterStatus === "open"
            ? Send
            : filterStatus === "approved"
              ? CheckCircle2
              : filterStatus === "rejected"
                ? XCircle
                : Inbox;

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight">
                    Contributions
                </h1>
            </div>

            {/* Tab bar */}
            <div className="flex items-center gap-1 border-b">
                {TABS.map(({ value, label, icon: Icon }) => {
                    const active = filterStatus === value;
                    const count = counts[value!];
                    return (
                        <button
                            key={value}
                            onClick={() => switchTab(value)}
                            className={`group relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                                active
                                    ? "text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Icon
                                className={`h-4 w-4 ${
                                    active
                                        ? value === "open"
                                            ? "text-green-500"
                                            : value === "approved"
                                              ? "text-purple-500"
                                              : "text-red-500"
                                        : ""
                                }`}
                            />
                            {label}
                            {count !== null && count > 0 && (
                                <span
                                    className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                                        active
                                            ? "bg-foreground/10 text-foreground"
                                            : "bg-muted text-muted-foreground"
                                    }`}
                                >
                                    {count >= 1 ? `${count}+` : "0"}
                                </span>
                            )}
                            {/* Active underline */}
                            {active && (
                                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-foreground" />
                            )}
                        </button>
                    );
                })}

                {/* "All" tab — right-aligned */}
                <button
                    onClick={() => switchTab(null)}
                    className={`relative ml-auto flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                        filterStatus === null
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                    All
                    {filterStatus === null && (
                        <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-foreground" />
                    )}
                </button>
            </div>

            {/* Content */}
            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />
                </div>
            ) : prs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <EmptyIcon className="h-10 w-10 mb-3 opacity-30" />
                    <p className="text-sm font-medium">{emptyMessage}</p>
                    <p className="text-xs mt-1 opacity-70">
                        {filterStatus === "open"
                            ? "Stage changes from the browse page to create one."
                            : "Contributions will appear here once they exist."}
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-px rounded-lg border overflow-hidden">
                    {prs.map((pr) => (
                        <PRCard key={pr.id} pr={pr} />
                    ))}
                </div>
            )}

            {/* Pagination */}
            {!loading && prs.length > 0 && (
                <div className="flex items-center justify-between pt-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-muted-foreground"
                        disabled={page === 1}
                        onClick={() => setPage((p) => p - 1)}
                    >
                        <ChevronLeft className="h-4 w-4" />
                        Newer
                    </Button>
                    <span className="text-xs tabular-nums text-muted-foreground">
                        Page {page}
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-muted-foreground"
                        disabled={prs.length < PAGE_SIZE}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Older
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    );
}

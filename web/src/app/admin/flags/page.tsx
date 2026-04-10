"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, X, Shield, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

interface FlagData {
    id: string;
    reporter_id: string | null;
    reporter: {
        id: string;
        display_name: string | null;
        email: string;
    } | null;
    target_type: string;
    target_id: string;
    reason: string;
    description: string | null;
    status: string;
    resolved_by: string | null;
    resolved_at: string | null;
    created_at: string;
}

interface PaginatedFlags {
    items: FlagData[];
    total: number;
    page: number;
    pages: number;
}

const STATUS_COLORS: Record<string, string> = {
    open: "bg-yellow-500/10 text-yellow-600",
    reviewing: "bg-blue-500/10 text-blue-600",
    resolved: "bg-green-500/10 text-green-600",
    dismissed: "bg-gray-500/10 text-gray-500",
};

const TARGET_LABELS: Record<string, string> = {
    material: "Material",
    annotation: "Annotation",
    pull_request: "Contribution",
    comment: "Comment",
    pr_comment: "Contribution Comment",
};

export default function AdminFlagsPage() {
    const [flags, setFlags] = useState<FlagData[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [statusFilter, setStatusFilter] = useState("open");
    const [targetTypeFilter, setTargetTypeFilter] = useState("all");
    const [loading, setLoading] = useState(false);

    const fetchFlags = useCallback(async (p: number) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(p), limit: "20" });
            if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
            if (targetTypeFilter && targetTypeFilter !== "all") params.set("targetType", targetTypeFilter);

            const data = await apiFetch<PaginatedFlags>(`/flags?${params}`);
            setFlags(data.items);
            setPage(data.page);
            setPages(data.pages);
        } catch {
            toast.error("Failed to load flags");
        } finally {
            setLoading(false);
        }
    }, [statusFilter, targetTypeFilter]);

    useEffect(() => {
        fetchFlags(1);
    }, [fetchFlags]);

    const handleAction = async (flagId: string, status: "resolved" | "dismissed") => {
        try {
            await apiFetch(`/flags/${flagId}`, {
                method: "PATCH",
                body: JSON.stringify({ status }),
            });
            toast.success(`Flag ${status}`);
            fetchFlags(page);
        } catch {
            toast.error("Failed to update flag");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex gap-3">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40">
                        <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="reviewing">Reviewing</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                        <SelectItem value="dismissed">Dismissed</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={targetTypeFilter} onValueChange={setTargetTypeFilter}>
                    <SelectTrigger className="w-40">
                        <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        <SelectItem value="material">Material</SelectItem>
                        <SelectItem value="annotation">Annotation</SelectItem>
                        <SelectItem value="pull_request">Contribution</SelectItem>
                        <SelectItem value="comment">Comment</SelectItem>
                        <SelectItem value="pr_comment">Contribution Comment</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {loading && flags.length === 0 && (
                <p className="text-sm text-muted-foreground">Loading...</p>
            )}

            {!loading && flags.length === 0 && (
                <Card>
                    <CardContent className="py-12 text-center">
                        <Shield className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
                        <p className="text-sm text-muted-foreground">No flags to review.</p>
                    </CardContent>
                </Card>
            )}

            <div className="space-y-3">
                {flags.map((flag) => (
                    <Card key={flag.id}>
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <CardTitle className="text-sm font-medium">
                                        {TARGET_LABELS[flag.target_type] ?? flag.target_type}
                                    </CardTitle>
                                    <Badge
                                        variant="outline"
                                        className={STATUS_COLORS[flag.status] ?? ""}
                                    >
                                        {flag.status}
                                    </Badge>
                                    <Badge variant="outline">{flag.reason}</Badge>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    {new Date(flag.created_at).toLocaleDateString()}
                                </span>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                <p className="text-xs text-muted-foreground">
                                    Reported by:{" "}
                                    <span className="font-medium text-foreground">
                                        {flag.reporter?.display_name ?? flag.reporter?.email ?? "Unknown"}
                                    </span>
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Target ID: <code className="text-xs">{flag.target_id}</code>
                                </p>
                                {flag.description && (
                                    <p className="rounded-md bg-muted/50 p-2 text-sm">
                                        {flag.description}
                                    </p>
                                )}
                                {flag.status === "open" && (
                                    <div className="flex gap-2 pt-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleAction(flag.id, "resolved")}
                                        >
                                            <Check className="mr-1 h-3.5 w-3.5" />
                                            Resolve
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleAction(flag.id, "dismissed")}
                                        >
                                            <X className="mr-1 h-3.5 w-3.5" />
                                            Dismiss
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {pages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => fetchFlags(page - 1)}
                    >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        Page {page} of {pages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= pages}
                        onClick={() => fetchFlags(page + 1)}
                    >
                        Next
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    );
}

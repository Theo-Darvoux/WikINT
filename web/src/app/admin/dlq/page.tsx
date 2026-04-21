"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-client";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";

interface DLQJob {
    id: string;
    job_name: string;
    upload_id: string | null;
    payload: Record<string, unknown> | null;
    error_detail: string | null;
    attempts: number;
    created_at: string;
    resolved_at: string | null;
}

interface PaginatedJobs {
    items: DLQJob[];
    total: number;
    page: number;
    pages: number;
}

export default function AdminDLQPage() {
    const [jobs, setJobs] = useState<DLQJob[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [showResolved, setShowResolved] = useState(false);
    const [loading, setLoading] = useState(true);
    const { show } = useConfirmDialog();

    const fetchJobs = async (p = page) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(p), limit: "25", resolved: String(showResolved) });
            const data = await apiFetch<PaginatedJobs>(`/admin/dlq?${params}`);
            setJobs(data.items);
            setPage(data.page);
            setPages(data.pages);
            setTotal(data.total);
        } catch {
            toast.error("Failed to load dead letter queue");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchJobs(1); }, [showResolved]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleRetry = (job: DLQJob) => {
        show(
            "Retry job?",
            `Re-enqueue "${job.job_name}"? It will run again with the original payload.`,
            async () => {
                try {
                    await apiFetch(`/admin/dlq/${job.id}/retry`, { method: "POST" });
                    toast.success("Job re-enqueued");
                    fetchJobs(page);
                } catch {
                    toast.error("Failed to retry job");
                }
            }
        );
    };

    const handleDismiss = (job: DLQJob) => {
        show(
            "Dismiss job?",
            `Mark "${job.job_name}" as resolved without retrying. This cannot be undone.`,
            async () => {
                try {
                    await apiFetch(`/admin/dlq/${job.id}/dismiss`, { method: "POST" });
                    toast.success("Job dismissed");
                    fetchJobs(page);
                } catch {
                    toast.error("Failed to dismiss job");
                }
            }
        );
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Switch
                        id="show-resolved"
                        checked={showResolved}
                        onCheckedChange={setShowResolved}
                    />
                    <Label htmlFor="show-resolved" className="text-sm text-muted-foreground">
                        Show resolved
                    </Label>
                </div>
                <span className="text-sm text-muted-foreground">
                    {total} job{total !== 1 ? "s" : ""}
                </span>
            </div>

            <div className="rounded-lg border bg-card">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="border-b bg-muted/50 text-muted-foreground">
                            <tr>
                                <th className="p-4 font-medium">Job</th>
                                <th className="p-4 font-medium hidden sm:table-cell">Attempts</th>
                                <th className="p-4 font-medium hidden md:table-cell">Error</th>
                                <th className="p-4 font-medium hidden sm:table-cell">Created</th>
                                <th className="p-4 font-medium text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {loading && jobs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
                                        Loading...
                                    </td>
                                </tr>
                            )}
                            {!loading && jobs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-10 text-center">
                                        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
                                        <p className="text-sm text-muted-foreground">
                                            {showResolved ? "No jobs found." : "No failed jobs. All good."}
                                        </p>
                                    </td>
                                </tr>
                            )}
                            {jobs.map((job) => (
                                <tr key={job.id} className="transition-colors hover:bg-muted/30">
                                    <td className="p-4">
                                        <div className="space-y-1">
                                            <p className="font-medium font-mono text-xs">{job.job_name}</p>
                                            {job.upload_id && (
                                                <p className="text-[11px] text-muted-foreground font-mono">
                                                    upload: {job.upload_id.slice(0, 8)}…
                                                </p>
                                            )}
                                            {job.resolved_at && (
                                                <Badge variant="secondary" className="text-[10px]">resolved</Badge>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-4 hidden sm:table-cell">
                                        <Badge variant={job.attempts >= 3 ? "destructive" : "outline"}>
                                            {job.attempts}
                                        </Badge>
                                    </td>
                                    <td className="p-4 hidden md:table-cell max-w-xs">
                                        {job.error_detail ? (
                                            <p className="truncate text-xs text-destructive font-mono" title={job.error_detail}>
                                                {job.error_detail}
                                            </p>
                                        ) : (
                                            <span className="text-muted-foreground text-xs">—</span>
                                        )}
                                    </td>
                                    <td className="p-4 text-muted-foreground text-xs hidden sm:table-cell">
                                        {job.created_at ? new Date(job.created_at).toLocaleString() : "—"}
                                    </td>
                                    <td className="p-4 text-right">
                                        {!job.resolved_at && (
                                            <div className="flex justify-end gap-1">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-8 gap-1.5"
                                                    onClick={() => handleRetry(job)}
                                                >
                                                    <RefreshCw className="h-3 w-3" />
                                                    Retry
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-8 gap-1.5 text-muted-foreground"
                                                    onClick={() => handleDismiss(job)}
                                                >
                                                    <X className="h-3 w-3" />
                                                    Dismiss
                                                </Button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {pages > 1 && (
                <div className="flex items-center justify-center gap-3">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => fetchJobs(page - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">{page} of {pages}</span>
                    <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => fetchJobs(page + 1)}>
                        Next
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    );
}

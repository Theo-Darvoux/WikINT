"use client";

import { use, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import {
    Loader2,
    ArrowLeft,
    FilePlus,
    FilePenLine,
    FileX,
    FolderPlus,
    FolderPen,
    FolderX,
    ArrowRightLeft,
    GitPullRequest,
    GitMerge,
    XCircle,
    Check,
    X,
    Eye,
    ExternalLink,
    ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
} from "@/components/ui/accordion";
import { Accordion as AccordionPrimitive } from "radix-ui";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { formatDistanceToNow } from "date-fns";
import { PRVoteButtons } from "@/components/pr/pr-vote-buttons";
import { PRComments } from "@/components/pr/pr-comments";
import Link from "next/link";
import { useAuthStore } from "@/lib/stores";

/* ── Types ──────────────────────────────────────────── */

interface PullRequestDetail {
    id: string;
    type: string;
    status: string;
    title: string;
    description: string | null;
    author: { id: string; display_name: string } | null;
    created_at: string;
    vote_score: number;
    user_vote: number;
    payload: Record<string, unknown>[] | Record<string, unknown>;
    summary_types?: string[];
}

/* ── Constants ──────────────────────────────────────── */

const OP_ICONS: Record<string, React.ElementType> = {
    create_material: FilePlus,
    edit_material: FilePenLine,
    delete_material: FileX,
    create_directory: FolderPlus,
    edit_directory: FolderPen,
    delete_directory: FolderX,
    move_item: ArrowRightLeft,
};

const OP_COLORS: Record<string, string> = {
    create_material: "text-green-600 bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800",
    edit_material: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
    delete_material: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
    create_directory: "text-green-600 bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800",
    edit_directory: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
    delete_directory: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
    move_item: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
};

const OP_LABELS: Record<string, string> = {
    create_material: "Create Material",
    edit_material: "Edit Material",
    delete_material: "Delete Material",
    create_directory: "Create Directory",
    edit_directory: "Edit Directory",
    delete_directory: "Delete Directory",
    move_item: "Move Item",
};

/** Fields worth displaying in the detail view (everything else is noise). */
const VISIBLE_FIELDS = new Set(["type", "tags", "description"]);

const STATUS_CONFIG: Record<
    string,
    { Icon: React.ElementType; color: string; bg: string; label: string }
> = {
    open: {
        Icon: GitPullRequest,
        color: "text-green-600",
        bg: "bg-green-500/10",
        label: "Open",
    },
    approved: {
        Icon: GitMerge,
        color: "text-purple-600",
        bg: "bg-purple-500/10",
        label: "Merged",
    },
    rejected: {
        Icon: XCircle,
        color: "text-red-600",
        bg: "bg-red-500/10",
        label: "Rejected",
    },
};

/* ── Helpers ─────────────────────────────────────────── */

function opSummary(op: Record<string, unknown>): string {
    const opType = String(op.op ?? op.pr_type ?? "unknown");
    switch (opType) {
        case "create_material":
            return `Add "${op.title}"`;
        case "edit_material":
            return `Edit material${op.title ? ` "${op.title}"` : ""}`;
        case "delete_material":
            return "Delete material";
        case "create_directory":
            return `Create folder "${op.name}"`;
        case "edit_directory":
            return `Rename folder${op.name ? ` to "${op.name}"` : ""}`;
        case "delete_directory":
            return "Delete folder";
        case "move_item":
            return `Move ${op.target_type ?? "item"}`;
        default:
            return opType;
    }
}

function formatValue(value: unknown): React.ReactNode {
    if (Array.isArray(value)) {
        if (value.length === 0) return <span className="text-muted-foreground">—</span>;
        return (
            <div className="flex flex-wrap gap-1">
                {value.map((v, i) => (
                    <Badge
                        key={i}
                        variant="secondary"
                        className="text-xs font-normal"
                    >
                        {String(v)}
                    </Badge>
                ))}
            </div>
        );
    }
    return String(value);
}

/** Resolve the browse URL for a directory ID via the /path endpoint. */
async function resolveBrowsePath(directoryId: string): Promise<string> {
    try {
        const path = await apiFetch<{ slug: string }[]>(
            `/directories/${directoryId}/path`,
        );
        const slugs = path.map((p) => p.slug).join("/");
        return `/browse/${slugs}`;
    } catch {
        return "/browse";
    }
}

function getInitials(name: string): string {
    return name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

/* ── OperationRow ────────────────────────────────────── */

function OperationRow({
    op,
    prId,
    prStatus,
    index,
}: {
    op: Record<string, unknown>;
    prId: string;
    prStatus: string;
    index: number;
}) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [browseUrl, setBrowseUrl] = useState<string | null>(null);

    const opType = String(op.op ?? op.pr_type ?? "unknown");
    const Icon = OP_ICONS[opType] ?? FilePlus;
    const colorClass = OP_COLORS[opType] ?? "";
    const hasFile = Boolean(op.file_key);
    const isDir = opType.includes("directory");
    const isApproved = prStatus === "approved";

    // After approval: result_browse_path is already in the op
    const resultBrowsePath = op.result_browse_path
        ? `/browse/${String(op.result_browse_path)}`
        : null;

    // Resolve file preview URL (works for both open and merged PRs)
    useEffect(() => {
        if (!hasFile) return;
        let cancelled = false;
        // Use microtask to avoid synchronous setState in effect body
        Promise.resolve().then(() => { if (!cancelled) setLoadingPreview(true); });
        apiFetch<{ url: string }>(
            `/pull-requests/${prId}/preview?opIndex=${index}`,
        )
            .then((res) => { if (!cancelled) setPreviewUrl(res.url); })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLoadingPreview(false); });
        return () => { cancelled = true; };
    }, [prId, index, hasFile]);

    // Resolve browse URL for directory operations (only when NOT approved)
    useEffect(() => {
        if (isApproved) return; // use resultBrowsePath instead
        const dirId = String(op.directory_id ?? op.parent_id ?? "");
        if (isDir && dirId && !dirId.startsWith("$")) {
            resolveBrowsePath(dirId).then(setBrowseUrl);
        }
    }, [op.directory_id, op.parent_id, isDir, isApproved]);

    // Visible metadata (type, tags, description only)
    const entries = Object.entries(op).filter(
        ([k, v]) => VISIBLE_FIELDS.has(k) && v !== null && v !== undefined,
    );

    // Determine what preview action to show
    const showBrowseLink = isApproved
        ? Boolean(resultBrowsePath)
        : isDir && browseUrl;

    const browseHref = isApproved ? resultBrowsePath : browseUrl;

    const browseLabel = isApproved
        ? "View"
        : opType === "create_directory"
          ? "Browse Parent"
          : "Browse";

    return (
        <AccordionItem
            value={`op-${index}`}
            className="border-b last:border-0"
        >
            {/* Row: trigger + preview buttons side by side */}
            <AccordionPrimitive.Header className="flex items-center">
                <AccordionPrimitive.Trigger className="flex flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40 [&[data-state=open]>svg.chevron]:rotate-180">
                    <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${colorClass}`}
                    >
                        <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                            {opSummary(op)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {OP_LABELS[opType] ?? opType}
                        </p>
                    </div>
                    <ChevronDown className="chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
                </AccordionPrimitive.Trigger>

                {/* Preview buttons — outside the trigger, not toggleable */}
                <div
                    className="flex shrink-0 items-center gap-1.5 pr-4"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* File preview */}
                    {hasFile &&
                        (loadingPreview ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : previewUrl ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 text-xs"
                                asChild
                            >
                                <a
                                    href={previewUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    <Eye className="h-3.5 w-3.5" />
                                    Preview
                                </a>
                            </Button>
                        ) : null)}

                    {/* Browse / View link */}
                    {showBrowseLink && browseHref && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            asChild
                        >
                            <Link href={browseHref}>
                                <ExternalLink className="h-3.5 w-3.5" />
                                {browseLabel}
                            </Link>
                        </Button>
                    )}
                </div>
            </AccordionPrimitive.Header>

            {/* Expandable metadata */}
            {entries.length > 0 && (
                <AccordionContent className="px-4 pb-4">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                        {entries.map(([k, v]) => (
                            <div key={k} className="contents">
                                <dt className="py-0.5 capitalize text-muted-foreground">
                                    {k}
                                </dt>
                                <dd className="py-0.5">
                                    {formatValue(v)}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </AccordionContent>
            )}
        </AccordionItem>
    );
}

/* ── Main Page ──────────────────────────────────────── */

interface PRDetailPageProps {
    params: Promise<{ id: string }>;
}

export default function PRDetailPage({ params }: PRDetailPageProps) {
    const { id } = use(params);
    const { user } = useAuthStore();
    const [pr, setPr] = useState<PullRequestDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState<"approve" | "reject" | null>(null);

    useEffect(() => {
        let active = true;
        setLoading(true);
        apiFetch<PullRequestDetail>(`/pull-requests/${id}`)
            .then((data) => {
                if (active) setPr(data);
            })
            .catch(console.error)
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [id]);

    const handleAction = async (action: "approve" | "reject") => {
        setActing(action);
        try {
            await apiFetch(`/pull-requests/${id}/${action}`, {
                method: "POST",
            });
            setPr((prev) =>
                prev
                    ? {
                          ...prev,
                          status:
                              action === "approve" ? "approved" : "rejected",
                      }
                    : prev,
            );
        } catch (e) {
            console.error(e);
        } finally {
            setActing(null);
        }
    };

    /* Loading */
    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    /* Not found */
    if (!pr) {
        return (
            <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
                <XCircle className="h-10 w-10" />
                <p className="text-sm">Pull request not found.</p>
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/pull-requests">← Back to list</Link>
                </Button>
            </div>
        );
    }

    const operations: Record<string, unknown>[] = Array.isArray(pr.payload)
        ? pr.payload
        : [pr.payload];

    const typeCounts: Record<string, number> = {};
    for (const op of operations) {
        const t = String(op.op ?? op.pr_type ?? "unknown");
        typeCounts[t] = (typeCounts[t] || 0) + 1;
    }

    const isAuthor = user?.id === pr.author?.id;
    const isModerator =
        user?.role === "member" ||
        user?.role === "bureau" ||
        user?.role === "vieux";

    const status = STATUS_CONFIG[pr.status] ?? STATUS_CONFIG.open;
    const StatusIcon = status.Icon;

    const initials = pr.author?.display_name
        ? getInitials(pr.author.display_name)
        : "?";

    return (
        <div className="container mx-auto max-w-4xl space-y-6 px-4 py-6">
            {/* Back link */}
            <Link
                href="/pull-requests"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
                <ArrowLeft className="h-3.5 w-3.5" />
                Pull Requests
            </Link>

            {/* ─── Header ─────────────────────────────── */}
            <div className="rounded-lg border bg-card shadow-sm">
                <div className="space-y-4 p-6">
                    {/* Status + ID row */}
                    <div className="flex items-center gap-2">
                        <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.color} ${status.bg}`}
                        >
                            <StatusIcon className="h-3.5 w-3.5" />
                            {status.label}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                            #{pr.id.slice(0, 8)}
                        </span>
                    </div>

                    {/* Title */}
                    <h1 className="text-xl font-semibold leading-tight">
                        {pr.title}
                    </h1>

                    {/* Author + date */}
                    <div className="flex items-center gap-2 text-sm">
                        <Avatar size="sm">
                            <AvatarFallback className="text-[10px]">
                                {initials}
                            </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">
                            {pr.author?.display_name || "[deleted]"}
                        </span>
                        <span className="text-muted-foreground">
                            opened{" "}
                            {formatDistanceToNow(new Date(pr.created_at), {
                                addSuffix: true,
                            })}
                        </span>
                    </div>

                    {/* Description */}
                    {pr.description && (
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            {pr.description}
                        </p>
                    )}

                    {/* Summary badges */}
                    <div className="flex flex-wrap gap-1.5">
                        {Object.entries(typeCounts).map(([type, count]) => {
                            const Icon = OP_ICONS[type] ?? FilePlus;
                            return (
                                <Badge
                                    key={type}
                                    variant="outline"
                                    className="gap-1 text-xs font-normal"
                                >
                                    <Icon className="h-3 w-3" />
                                    {count} {OP_LABELS[type] ?? type}
                                </Badge>
                            );
                        })}
                    </div>
                </div>

                {/* Toolbar: Vote + Actions */}
                <Separator />
                <div className="flex items-center justify-between px-6 py-3">
                    <PRVoteButtons
                        prId={pr.id}
                        initialScore={pr.vote_score}
                        initialUserVote={pr.user_vote}
                        disabled={isAuthor || pr.status !== "open"}
                        onAutoApprove={() =>
                            setPr((p) =>
                                p ? { ...p, status: "approved" } : p,
                            )
                        }
                    />

                    {pr.status === "open" && isModerator && (
                        <div className="flex items-center gap-2">
                            <Button
                                size="sm"
                                className="gap-1.5 bg-green-600 text-white hover:bg-green-700"
                                onClick={() => handleAction("approve")}
                                disabled={acting !== null}
                            >
                                {acting === "approve" ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Check className="h-3.5 w-3.5" />
                                )}
                                Approve
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                className="gap-1.5"
                                onClick={() => handleAction("reject")}
                                disabled={acting !== null}
                            >
                                {acting === "reject" ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <X className="h-3.5 w-3.5" />
                                )}
                                Reject
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* ─── Operations ─────────────────────────── */}
            <div className="overflow-hidden rounded-lg border bg-card">
                <div className="border-b bg-muted/50 px-4 py-2.5 text-sm font-medium text-muted-foreground">
                    Proposed Changes
                    <span className="ml-1.5 text-foreground/60">
                        · {operations.length} operation
                        {operations.length !== 1 ? "s" : ""}
                    </span>
                </div>
                <Accordion type="multiple" className="w-full">
                    {operations.map((op, i) => (
                        <OperationRow
                            key={i}
                            op={op}
                            prId={pr.id}
                            prStatus={pr.status}
                            index={i}
                        />
                    ))}
                </Accordion>
            </div>

            {/* ─── Comments ───────────────────────────── */}
            <div className="overflow-hidden rounded-lg border bg-card">
                <div className="border-b bg-muted/50 px-4 py-2.5 text-sm font-medium text-muted-foreground">
                    Discussion
                </div>
                <div className="p-4">
                    <PRComments prId={pr.id} />
                </div>
            </div>
        </div>
    );
}

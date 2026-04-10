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
    Upload,
    CheckCircle2,
    XCircle,
    Check,
    X,
    Eye,
    ExternalLink,
    ChevronDown,
    Clock,
    ChevronsDownUp,
    ChevronsUpDown,
    AlertCircle,
    Image,
    FileText,
    Video,
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatDistanceToNow } from "date-fns";
import { PRComments } from "@/components/pr/pr-comments";
import Link from "next/link";
import { useAuthStore } from "@/lib/stores";
import { toast } from "sonner";

/* ── Types ──────────────────────────────────────────── */

interface PullRequestDetail {
    id: string;
    type: string;
    status: string;
    title: string;
    description: string | null;
    rejection_reason: string | null;
    author: { id: string; display_name: string } | null;
    created_at: string;
    updated_at: string;
    vote_score: number;
    user_vote: number;
    payload: Record<string, unknown>[] | Record<string, unknown>;
    applied_result?: Record<string, unknown>[] | null;
    summary_types?: string[];
    virus_scan_result?: string;
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
    create_material: "Ajout de document",
    edit_material: "Modification de document",
    delete_material: "Suppression de document",
    create_directory: "Création de dossier",
    edit_directory: "Modification de dossier",
    delete_directory: "Suppression de dossier",
    move_item: "Déplacement",
};

/** Fields worth displaying in the detail view (everything else is noise). */
const VISIBLE_FIELDS = new Set(["type", "tags", "description"]);

const FRIENDLY_TYPES: Record<string, string> = {
    document: "Document",
    polycopie: "Polycopié",
    annal: "Annale",
    cheatsheet: "Cheatsheet",
    tip: "Conseil",
    review: "Révision",
    discussion: "Discussion",
    video: "Vidéo",
    other: "Autre",
};

const STATUS_CONFIG: Record<
    string,
    { Icon: React.ElementType; color: string; bg: string; label: string }
> = {
    open: {
        Icon: Upload,
        color: "text-blue-600",
        bg: "bg-blue-500/10",
        label: "En attente",
    },
    approved: {
        Icon: CheckCircle2,
        color: "text-green-600",
        bg: "bg-green-500/10",
        label: "Publié",
    },
    rejected: {
        Icon: XCircle,
        color: "text-red-600",
        bg: "bg-red-500/10",
        label: "Refusé",
    },
};

/* ── Helpers ─────────────────────────────────────────── */

function opSummary(op: Record<string, unknown>): string {
    const opType = String(op.op ?? op.pr_type ?? "unknown");
    switch (opType) {
        case "create_material":
            return `Ajouter « ${op.title} »`;
        case "edit_material":
            return `Modifier${op.title ? ` « ${op.title} »` : " le document"}`;
        case "delete_material":
            return "Supprimer le document";
        case "create_directory":
            return `Créer le dossier « ${op.name} »`;
        case "edit_directory":
            return `Renommer le dossier${op.name ? ` en « ${op.name} »` : ""}`;
        case "delete_directory":
            return "Supprimer le dossier";
        case "move_item":
            return `Déplacer le ${op.target_type === "directory" ? "dossier" : "document"}`;
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
    // Translate known type values
    const str = String(value);
    return FRIENDLY_TYPES[str] ?? str;
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

/* ── Inline preview dialog ───────────────────────────── */

function PreviewDialog({
    url,
    mimeType,
    fileName,
    onClose,
}: {
    url: string;
    mimeType?: string;
    fileName?: string;
    onClose: () => void;
}) {
    const isImage = mimeType?.startsWith("image/");
    const isVideo = mimeType?.startsWith("video/");
    const isPdf = mimeType === "application/pdf";

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-4xl w-full p-0 overflow-hidden">
                <DialogHeader className="px-4 pt-4 pb-2">
                    <DialogTitle className="flex items-center gap-2 text-sm font-medium">
                        {isPdf && <FileText className="h-4 w-4 text-red-500" />}
                        {isImage && <Image className="h-4 w-4 text-blue-500" />}
                        {isVideo && <Video className="h-4 w-4 text-purple-500" />}
                        {!isPdf && !isImage && !isVideo && <Eye className="h-4 w-4 text-muted-foreground" />}
                        {fileName ?? "Aperçu"}
                    </DialogTitle>
                </DialogHeader>
                <div className="px-4 pb-4">
                    {isImage && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={url}
                            alt={fileName ?? "Aperçu"}
                            className="max-h-[70vh] w-full rounded-lg object-contain bg-muted/30"
                        />
                    )}
                    {isVideo && (
                        <video
                            src={url}
                            controls
                            className="w-full max-h-[70vh] rounded-lg bg-black"
                        />
                    )}
                    {isPdf && (
                        <iframe
                            src={url}
                            className="w-full rounded-lg border"
                            style={{ height: "70vh" }}
                            title={fileName ?? "PDF"}
                        />
                    )}
                    {!isImage && !isVideo && !isPdf && (
                        <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
                            <Eye className="h-10 w-10 opacity-30" />
                            <p className="text-sm">Aperçu non disponible pour ce type de fichier.</p>
                            <Button asChild variant="outline" size="sm">
                                <a href={url} target="_blank" rel="noreferrer">
                                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                                    Ouvrir dans un nouvel onglet
                                </a>
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
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
    const [isExpanded, setIsExpanded] = useState(false);
    const [showPreviewDialog, setShowPreviewDialog] = useState(false);

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

    // (O8) Lazy-load preview only when expanded or if explicitly requested
    useEffect(() => {
        if (!hasFile || !isExpanded || previewUrl || loadingPreview) return;

        let cancelled = false;
        setLoadingPreview(true);
        apiFetch<{ url: string }>(
            `/pull-requests/${prId}/preview?opIndex=${index}`,
        )
            .then((res) => { if (!cancelled) setPreviewUrl(res.url); })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLoadingPreview(false); });
        return () => { cancelled = true; };
    }, [prId, index, hasFile, isExpanded, previewUrl, loadingPreview]);

    // Resolve browse URL for directory operations (only when NOT approved)
    useEffect(() => {
        if (isApproved) return;
        const dirId = String(op.directory_id ?? op.parent_id ?? "");
        if (isDir && dirId && !dirId.startsWith("$")) {
            resolveBrowsePath(dirId).then(setBrowseUrl);
        }
    }, [op.directory_id, op.parent_id, isDir, isApproved]);

    // Visible metadata (type, tags, description only)
    const entries = Object.entries(op).filter(
        ([k, v]) => VISIBLE_FIELDS.has(k) && v !== null && v !== undefined,
    );

    const showBrowseLink = isApproved
        ? Boolean(resultBrowsePath)
        : isDir && browseUrl;

    const browseHref = isApproved ? resultBrowsePath : browseUrl;
    const browseLabel = isApproved ? "Voir" : "Parcourir";

    const mimeType = op.file_mime_type as string | undefined;
    const fileName = op.file_name as string | undefined;

    return (
        <>
            <AccordionItem
                value={`op-${index}`}
                className="border-b last:border-0"
                onMouseEnter={() => { if (hasFile) setIsExpanded(true); }}
            >
                {/* Row: trigger + preview buttons side by side */}
                <AccordionPrimitive.Header className="flex items-center">
                    <AccordionPrimitive.Trigger
                        className="flex flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40 [&[data-state=open]>svg.chevron]:rotate-180"
                        onClick={() => setIsExpanded(true)}
                    >
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

                    {/* Preview buttons — outside the trigger */}
                    <div
                        className="flex shrink-0 items-center gap-1.5 pr-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Inline file preview */}
                        {hasFile && (
                            loadingPreview ? (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : previewUrl ? (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 gap-1.5 text-xs"
                                    onClick={() => setShowPreviewDialog(true)}
                                >
                                    <Eye className="h-3.5 w-3.5" />
                                    Aperçu
                                </Button>
                            ) : null
                        )}

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
                                        {k === "type" ? "Type" : k === "tags" ? "Tags" : k === "description" ? "Description" : k}
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

            {showPreviewDialog && previewUrl && (
                <PreviewDialog
                    url={previewUrl}
                    mimeType={mimeType}
                    fileName={fileName}
                    onClose={() => setShowPreviewDialog(false)}
                />
            )}
        </>
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
    const [showApproveConfirm, setShowApproveConfirm] = useState(false);
    const [showRejectDialog, setShowRejectDialog] = useState(false);
    const [rejectReason, setRejectReason] = useState("");
    const [expandedItems, setExpandedItems] = useState<string[]>([]);

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

    const handleApprove = async () => {
        setActing("approve");
        setShowApproveConfirm(false);
        try {
            await apiFetch(`/pull-requests/${id}/approve`, { method: "POST" });
            setPr((prev) => prev ? { ...prev, status: "approved" } : prev);
            toast.success("Contribution publiée");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Échec de la publication");
        } finally {
            setActing(null);
        }
    };

    const handleReject = async () => {
        if (rejectReason.trim().length < 10) return;
        setActing("reject");
        setShowRejectDialog(false);
        try {
            await apiFetch(`/pull-requests/${id}/reject`, {
                method: "POST",
                body: JSON.stringify({ reason: rejectReason.trim() }),
            });
            setPr((prev) => prev ? { ...prev, status: "rejected", rejection_reason: rejectReason.trim() } : prev);
            setRejectReason("");
            toast("Contribution refusée");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Échec du refus");
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
                <p className="text-sm">Contribution introuvable.</p>
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/pull-requests">← Retour à la liste</Link>
                </Button>
            </div>
        );
    }

    // Use applied_result for approved PRs (contains result_browse_path); fall back to payload
    const operations: Record<string, unknown>[] = pr.status === "approved" && Array.isArray(pr.applied_result) && pr.applied_result.length > 0
        ? pr.applied_result
        : Array.isArray(pr.payload)
            ? pr.payload
            : [pr.payload];

    const typeCounts: Record<string, number> = {};
    for (const op of operations) {
        const t = String(op.op ?? op.pr_type ?? "unknown");
        typeCounts[t] = (typeCounts[t] || 0) + 1;
    }

    const isModerator =
        user?.role === "moderator" ||
        user?.role === "bureau" ||
        user?.role === "vieux";
    const status = STATUS_CONFIG[pr.status] ?? STATUS_CONFIG.open;
    const StatusIcon = status.Icon;

    const initials = pr.author?.display_name
        ? getInitials(pr.author.display_name)
        : "?";

    // Expiration calculation
    const updatedDate = new Date(pr.updated_at);
    const expiresDate = new Date(updatedDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const isExpiringSoon = pr.status === "open" && (expiresDate.getTime() - Date.now() < 24 * 60 * 60 * 1000);

    const allItemValues = operations.map((_, i) => `op-${i}`);
    const allExpanded = expandedItems.length === allItemValues.length;

    return (
        <div className="container mx-auto max-w-4xl space-y-6 px-4 py-6 pb-20 md:pb-6">
            {/* Back link */}
            <Link
                href="/pull-requests"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
                <ArrowLeft className="h-3.5 w-3.5" />
                Contributions
            </Link>

            {/* ─── Rejection reason banner ─────────────── */}
            {pr.status === "rejected" && pr.rejection_reason && (
                <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/20">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div>
                        <p className="text-sm font-medium text-red-700 dark:text-red-400">
                            Raison du refus
                        </p>
                        <p className="mt-1 text-sm text-red-600/90 dark:text-red-400/80">
                            {pr.rejection_reason}
                        </p>
                    </div>
                </div>
            )}

            {/* ─── Header ─────────────────────────────── */}
            <div className="rounded-lg border bg-card shadow-sm">
                <div className="space-y-4 p-6">
                    {/* Status row */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.color} ${status.bg}`}
                        >
                            <StatusIcon className="h-3.5 w-3.5" />
                            {status.label}
                        </span>
                    </div>

                    {/* Title */}
                    <h1 className="text-xl font-semibold leading-tight">
                        {pr.title}
                    </h1>

                    {/* Author + date */}
                    <div className="flex items-center gap-2 text-sm flex-wrap">
                        <Avatar size="sm">
                            <AvatarFallback className="text-[10px]">
                                {initials}
                            </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">
                            {pr.author?.display_name || "[compte supprimé]"}
                        </span>
                        <span className="text-muted-foreground">
                            soumis{" "}
                            {formatDistanceToNow(new Date(pr.created_at), {
                                addSuffix: true,
                            })}
                        </span>
                        {pr.status === "open" && (
                            <>
                                <span className="text-muted-foreground">·</span>
                                <span className={`flex items-center gap-1 text-xs ${isExpiringSoon ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                                    <Clock className="h-3 w-3" />
                                    {isExpiringSoon
                                        ? `Expire ${formatDistanceToNow(expiresDate, { addSuffix: true })}`
                                        : "Expire dans 7 jours si non traité"}
                                </span>
                            </>
                        )}
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

                {/* Moderator toolbar */}
                {pr.status === "open" && isModerator && (
                    <>
                        <Separator />
                        <div className="flex items-center justify-end gap-2 px-6 py-3">
                            <Button
                                size="sm"
                                className="gap-1.5 bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                                onClick={() => setShowApproveConfirm(true)}
                                disabled={acting !== null}
                            >
                                {acting === "approve" ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Check className="h-3.5 w-3.5" />
                                )}
                                Publier
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                className="gap-1.5"
                                onClick={() => setShowRejectDialog(true)}
                                disabled={acting !== null}
                            >
                                {acting === "reject" ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <X className="h-3.5 w-3.5" />
                                )}
                                Refuser
                            </Button>
                        </div>
                    </>
                )}
            </div>

            {/* ─── Operations ─────────────────────────── */}
            <div className="overflow-hidden rounded-lg border bg-card">
                <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2.5">
                    <span className="text-sm font-medium text-muted-foreground">
                        Modifications proposées
                        <span className="ml-1.5 text-foreground/60">
                            · {operations.length} modification
                            {operations.length !== 1 ? "s" : ""}
                        </span>
                    </span>
                    {operations.length > 1 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs text-muted-foreground"
                            onClick={() =>
                                setExpandedItems(allExpanded ? [] : allItemValues)
                            }
                        >
                            {allExpanded ? (
                                <>
                                    <ChevronsDownUp className="h-3.5 w-3.5" />
                                    Tout réduire
                                </>
                            ) : (
                                <>
                                    <ChevronsUpDown className="h-3.5 w-3.5" />
                                    Tout développer
                                </>
                            )}
                        </Button>
                    )}
                </div>
                <Accordion
                    type="multiple"
                    className="w-full"
                    value={expandedItems}
                    onValueChange={setExpandedItems}
                >
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

            {/* ─── Approve confirmation dialog ────────── */}
            <Dialog open={showApproveConfirm} onOpenChange={setShowApproveConfirm}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Publier cette contribution ?</DialogTitle>
                        <DialogDescription>
                            {operations.length} modification{operations.length !== 1 ? "s" : ""} seront appliquées définitivement.
                            Cette action ne peut pas être annulée.
                        </DialogDescription>
                    </DialogHeader>
                    {/* Quick summary of operations */}
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm space-y-1 max-h-40 overflow-y-auto">
                        {operations.slice(0, 10).map((op, i) => {
                            const Icon = OP_ICONS[String(op.op ?? "")] ?? FilePlus;
                            return (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="truncate">{opSummary(op)}</span>
                                </div>
                            );
                        })}
                        {operations.length > 10 && (
                            <p className="text-xs text-muted-foreground">
                                + {operations.length - 10} autres modifications
                            </p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowApproveConfirm(false)}>
                            Annuler
                        </Button>
                        <Button
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={handleApprove}
                        >
                            <Check className="mr-2 h-4 w-4" />
                            Publier
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ─── Reject dialog ──────────────────────── */}
            <Dialog open={showRejectDialog} onOpenChange={(open) => { setShowRejectDialog(open); if (!open) setRejectReason(""); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Refuser cette contribution</DialogTitle>
                        <DialogDescription>
                            Expliquez pourquoi cette contribution est refusée.
                            Cette raison sera visible par l&apos;auteur.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Textarea
                            placeholder="Ex : Le document est en double, le titre n'est pas assez descriptif…"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            rows={4}
                            maxLength={1000}
                            autoFocus
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{rejectReason.trim().length < 10 ? `${10 - rejectReason.trim().length} caractères min.` : ""}</span>
                            <span>{rejectReason.length}/1000</span>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setShowRejectDialog(false); setRejectReason(""); }}>
                            Annuler
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={rejectReason.trim().length < 10}
                            onClick={handleReject}
                        >
                            <X className="mr-2 h-4 w-4" />
                            Refuser
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

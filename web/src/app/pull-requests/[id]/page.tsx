"use client";

import { use, useEffect, useState, useMemo } from "react";
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
    MapPin,
    ArrowRight,
} from "lucide-react";
import { PreviewDialog } from "@/components/pr/preview-dialog";
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
    create_material: "Add document",
    edit_material: "Edit document",
    delete_material: "Delete document",
    create_directory: "Create folder",
    edit_directory: "Edit folder",
    delete_directory: "Delete folder",
    move_item: "Move",
};

/** Fields worth displaying in the detail view (everything else is noise). */
const VISIBLE_FIELDS = new Set(["type", "tags", "description"]);

const FRIENDLY_TYPES: Record<string, string> = {
    document: "Document",
    polycopie: "Handout",
    annal: "Past exam",
    cheatsheet: "Cheatsheet",
    tip: "Tip",
    review: "Review",
    discussion: "Discussion",
    video: "Video",
    other: "Other",
};

const STATUS_CONFIG: Record<
    string,
    { Icon: React.ElementType; color: string; bg: string; label: string }
> = {
    open: {
        Icon: Upload,
        color: "text-blue-600",
        bg: "bg-blue-500/10",
        label: "Pending",
    },
    approved: {
        Icon: CheckCircle2,
        color: "text-green-600",
        bg: "bg-green-500/10",
        label: "Published",
    },
    rejected: {
        Icon: XCircle,
        color: "text-red-600",
        bg: "bg-red-500/10",
        label: "Rejected",
    },
};

/* ── Types ───────────────────────────────────────────── */

interface ResolvedItemDetails {
    /** Display name of the item being moved or deleted */
    itemName?: string;
    /** Human-readable path of the item's current location */
    sourcePath?: string;
    /** Browse URL for the source location */
    sourceUrl?: string;
    /** Human-readable destination path (move only) */
    destPath?: string;
    /** Browse URL for the destination (move only) */
    destUrl?: string;
    /** Material ID for fetching inline preview */
    materialId?: string;
    /** MIME type for preview */
    mimeType?: string;
    /** File name for preview dialog */
    fileName?: string;
}

/* ── Helpers ─────────────────────────────────────────── */

function opSummary(op: Record<string, unknown>): string {
    const opType = String(op.op ?? op.pr_type ?? "unknown");
    switch (opType) {
        case "create_material":
            return `Add « ${op.title} »`;
        case "edit_material":
            return `Edit${op.title ? ` « ${op.title} »` : " document"}`;
        case "delete_material":
            return "Delete document";
        case "create_directory":
            return `Create folder « ${op.name} »`;
        case "edit_directory":
            return `Rename folder${op.name ? ` to « ${op.name} »` : ""}`;
        case "delete_directory":
            return "Delete folder";
        case "move_item":
            return `Move ${op.target_type === "directory" ? "folder" : "document"}`;
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

/** Resolve the browse URL and label for a directory ID via the /path endpoint. */
async function resolveTargetPath(directoryId: string): Promise<{ url: string; label: string }> {
    try {
        const path = await apiFetch<{ name: string; slug: string }[]>(
            `/directories/${directoryId}/path`,
        );
        if (path.length === 0) return { url: "/browse", label: "Root" };
        const slugs = path.map((p) => p.slug).join("/");
        const label = path.map((p) => p.name).join(" › ");
        return { url: `/browse/${slugs}`, label };
    } catch {
        return { url: "/browse", label: "Root" };
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

export function PreviewDialog_OMIT({
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
                        {fileName ?? "Preview"}
                    </DialogTitle>
                </DialogHeader>
                <div className="px-4 pb-4">
                    {isImage && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={url}
                            alt={fileName ?? "Preview"}
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
                            <p className="text-sm">Preview unavailable for this file type.</p>
                            <Button asChild variant="outline" size="sm">
                                <a href={url} target="_blank" rel="noreferrer">
                                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                                    Open in new tab
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
    const [targetInfo, setTargetInfo] = useState<{ url: string; label: string } | null>(null);
    const [itemDetails, setItemDetails] = useState<ResolvedItemDetails | null>(null);
    const [existingPreview, setExistingPreview] = useState<{ url: string; mimeType?: string; fileName?: string } | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    const opType = String(op.op ?? op.pr_type ?? "unknown");
    const Icon = OP_ICONS[opType] ?? FilePlus;
    const colorClass = OP_COLORS[opType] ?? "";
    const hasFile = Boolean(op.file_key);
    const isApproved = prStatus === "approved";

    // After approval: result_browse_path is already in the op
    const resultBrowsePath = op.result_browse_path
        ? `/browse/${String(op.result_browse_path)}`
        : null;

    const needsItemResolution =
        opType === "delete_material" ||
        opType === "delete_directory" ||
        opType === "move_item";

    // Resolve target path for create/edit ops (shows location context)
    useEffect(() => {
        if (needsItemResolution) return; // handled by the other effect
        if (isApproved) return;

        let cancelled = false;
        async function fetchInfo() {
            let dirId = String(op.directory_id ?? op.parent_id ?? "");
            const matId = String(op.material_id ?? "");

            if (!dirId && matId && !matId.startsWith("$")) {
                try {
                    const mat = await apiFetch<{ directory_id: string | null }>(`/materials/${matId}`);
                    if (mat.directory_id) dirId = mat.directory_id;
                } catch { /* ignore */ }
            }

            if (dirId && !dirId.startsWith("$") && !cancelled) {
                const info = await resolveTargetPath(dirId);
                if (!cancelled) setTargetInfo(info);
            }
        }

        fetchInfo();
        return () => { cancelled = true; };
    }, [op.directory_id, op.parent_id, op.material_id, isApproved, needsItemResolution]);

    // Resolve item name + paths for delete/move ops
    useEffect(() => {
        if (!needsItemResolution) return;

        const matId = String(op.material_id ?? "");
        const dirId = String(op.directory_id ?? "");
        const targetId = String(op.target_id ?? "");

        // Don't try to resolve temp IDs
        if (matId.startsWith("$") || dirId.startsWith("$") || targetId.startsWith("$")) return;

        let cancelled = false;

        async function resolveDetails() {
            try {
                if (opType === "delete_material") {
                    if (!matId) return;
                    const mat = await apiFetch<{
                        title: string;
                        directory_id: string | null;
                        current_version_info?: { file_mime_type?: string; file_name?: string } | null;
                    }>(`/materials/${matId}`);
                    if (cancelled) return;
                    let sourcePath: string | undefined;
                    let sourceUrl: string | undefined;
                    if (mat.directory_id) {
                        const info = await resolveTargetPath(mat.directory_id);
                        if (!cancelled) { sourcePath = info.label; sourceUrl = info.url; }
                    } else {
                        sourcePath = "Root";
                        sourceUrl = "/browse";
                    }
                    if (!cancelled) setItemDetails({
                        itemName: mat.title,
                        sourcePath,
                        sourceUrl,
                        materialId: matId,
                        mimeType: mat.current_version_info?.file_mime_type ?? undefined,
                        fileName: mat.current_version_info?.file_name ?? undefined,
                    });

                } else if (opType === "delete_directory") {
                    if (!dirId) return;
                    const path = await apiFetch<{ name: string; slug: string }[]>(`/directories/${dirId}/path`);
                    if (cancelled) return;
                    if (path.length === 0) { setItemDetails({ itemName: "Root" }); return; }
                    const itemName = path[path.length - 1].name;
                    const parentSegs = path.slice(0, -1);
                    const sourcePath = parentSegs.length > 0
                        ? parentSegs.map((p) => p.name).join(" › ")
                        : "Root";
                    const parentSlugs = parentSegs.map((p) => p.slug).join("/");
                    if (!cancelled) setItemDetails({
                        itemName,
                        sourcePath,
                        sourceUrl: parentSlugs ? `/browse/${parentSlugs}` : "/browse",
                    });

                } else if (opType === "move_item") {
                    if (!targetId) return;
                    const targetType = String(op.target_type ?? "");
                    let itemName: string | undefined;
                    let sourcePath: string | undefined;
                    let sourceUrl: string | undefined;
                    let materialId: string | undefined;
                    let mimeType: string | undefined;
                    let fileName: string | undefined;

                    if (targetType === "material") {
                        const mat = await apiFetch<{
                            title: string;
                            directory_id: string | null;
                            current_version_info?: { file_mime_type?: string; file_name?: string } | null;
                        }>(`/materials/${targetId}`);
                        if (cancelled) return;
                        itemName = mat.title;
                        materialId = targetId;
                        mimeType = mat.current_version_info?.file_mime_type ?? undefined;
                        fileName = mat.current_version_info?.file_name ?? undefined;
                        if (mat.directory_id) {
                            const info = await resolveTargetPath(mat.directory_id);
                            if (!cancelled) { sourcePath = info.label; sourceUrl = info.url; }
                        } else {
                            sourcePath = "Root";
                            sourceUrl = "/browse";
                        }
                    } else {
                        // directory
                        const path = await apiFetch<{ name: string; slug: string }[]>(`/directories/${targetId}/path`);
                        if (cancelled) return;
                        if (path.length > 0) {
                            itemName = path[path.length - 1].name;
                            const parentSegs = path.slice(0, -1);
                            sourcePath = parentSegs.length > 0
                                ? parentSegs.map((p) => p.name).join(" › ")
                                : "Root";
                            const parentSlugs = parentSegs.map((p) => p.slug).join("/");
                            sourceUrl = parentSlugs ? `/browse/${parentSlugs}` : "/browse";
                        }
                    }

                    // Resolve destination
                    const newParentId = op.new_parent_id ? String(op.new_parent_id) : null;
                    let destPath = "Root";
                    let destUrl = "/browse";
                    if (newParentId && !newParentId.startsWith("$")) {
                        const info = await resolveTargetPath(newParentId);
                        if (!cancelled) { destPath = info.label; destUrl = info.url; }
                    }

                    if (!cancelled) setItemDetails({ itemName, sourcePath, sourceUrl, destPath, destUrl, materialId, mimeType, fileName });
                }
            } catch { /* Silently ignore — item may not exist (e.g., deleted after approval) */ }
        }

        resolveDetails();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opType, op.material_id, op.directory_id, op.target_id, op.new_parent_id, op.target_type, needsItemResolution]);

    // Fetch inline preview URL for an existing material
    const handleExistingPreview = async () => {
        const matId = itemDetails?.materialId;
        if (!matId) return;
        setPreviewLoading(true);
        try {
            const res = await apiFetch<{ url: string }>(`/materials/${matId}/inline`);
            setExistingPreview({
                url: res.url,
                mimeType: itemDetails?.mimeType,
                fileName: itemDetails?.fileName,
            });
        } catch {
            // ignore
        } finally {
            setPreviewLoading(false);
        }
    };

    // Derive summary text using resolved item name when available
    const displaySummary = (() => {
        const name = itemDetails?.itemName;
        if (opType === "delete_material") return `Delete « ${name ?? (op.title as string) ?? "document"} »`;
        if (opType === "delete_directory") return `Delete folder « ${name ?? "folder"} »`;
        if (opType === "move_item") {
            const isDir = op.target_type === "directory";
            return `Move ${isDir ? "folder " : ""}« ${name ?? (isDir ? "folder" : "document")} »`;
        }
        return opSummary(op);
    })();

    // Visible metadata (type, tags, description only)
    const entries = Object.entries(op).filter(
        ([k, v]) => VISIBLE_FIELDS.has(k) && v !== null && v !== undefined,
    );

    const showBrowseLink = isApproved
        ? Boolean(resultBrowsePath)
        : targetInfo?.url;

    const browseHref = isApproved ? resultBrowsePath : targetInfo?.url;
    const browseLabel = isApproved ? "View" : "Browse";

    // For approved move ops, link to the new location
    const approvedMoveHref = isApproved && opType === "move_item" && resultBrowsePath
        ? resultBrowsePath
        : null;

    const canPreviewExisting = Boolean(itemDetails?.materialId) && !previewLoading;

    return (
        <>
            {existingPreview && (
                <PreviewDialog
                    url={existingPreview.url}
                    mimeType={existingPreview.mimeType}
                    fileName={existingPreview.fileName}
                    onClose={() => setExistingPreview(null)}
                />
            )}
            <AccordionItem
                value={`op-${index}`}
                className="border-b last:border-0"
            >
                {/* Row: trigger + action buttons side by side */}
                <AccordionPrimitive.Header className="flex items-center">
                    <AccordionPrimitive.Trigger
                        className="flex flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40 [&[data-state=open]>svg.chevron]:rotate-180"
                    >
                        <div
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${colorClass}`}
                        >
                            <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                                {displaySummary}
                            </p>
                            {/* Subtitle: location context */}
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5 flex-wrap">
                                <span className={colorClass.split(" ")[0]}>{OP_LABELS[opType] ?? opType}</span>

                                {/* Create/edit: show target directory */}
                                {targetInfo && (
                                    <>
                                        <span className="opacity-40">·</span>
                                        <div className="flex items-center gap-1 max-w-[200px]">
                                            <MapPin className="h-3 w-3 shrink-0 opacity-60" />
                                            <span className="truncate">{targetInfo.label}</span>
                                        </div>
                                    </>
                                )}

                                {/* Move: show from → to */}
                                {opType === "move_item" && itemDetails && (
                                    <>
                                        <span className="opacity-40">·</span>
                                        {itemDetails.sourcePath && (
                                            <div className="flex items-center gap-1 shrink-0">
                                                <MapPin className="h-3 w-3 shrink-0 opacity-60" />
                                                <span className="truncate max-w-[120px]">{itemDetails.sourcePath}</span>
                                            </div>
                                        )}
                                        <ArrowRight className="h-3 w-3 shrink-0 opacity-60" />
                                        <div className="flex items-center gap-1 shrink-0">
                                            <MapPin className="h-3 w-3 shrink-0 opacity-60" />
                                            <span className="truncate max-w-[120px]">
                                                {isApproved && resultBrowsePath
                                                    ? itemDetails.destPath ?? "Root"
                                                    : (itemDetails.destPath ?? "Root")}
                                            </span>
                                        </div>
                                    </>
                                )}

                                {/* Delete: show current location */}
                                {(opType === "delete_material" || opType === "delete_directory") && itemDetails?.sourcePath && (
                                    <>
                                        <span className="opacity-40">·</span>
                                        <div className="flex items-center gap-1 max-w-[200px]">
                                            <MapPin className="h-3 w-3 shrink-0 opacity-60" />
                                            <span className="truncate">{itemDetails.sourcePath}</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                        <ChevronDown className="chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
                    </AccordionPrimitive.Trigger>

                    {/* Action buttons — outside the trigger */}
                    <div
                        className="flex shrink-0 items-center gap-1.5 pr-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Preview staged upload (create/edit with file) */}
                        {hasFile && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 text-xs"
                                asChild
                            >
                                <Link href={`/pull-requests/${prId}/preview/${index}`}>
                                    <Eye className="h-3.5 w-3.5" />
                                    Preview
                                </Link>
                            </Button>
                        )}

                        {/* Preview existing material (for delete/move ops) */}
                        {canPreviewExisting && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 text-xs"
                                onClick={handleExistingPreview}
                                disabled={previewLoading}
                            >
                                {previewLoading
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <Eye className="h-3.5 w-3.5" />}
                                Preview
                            </Button>
                        )}

                        {/* Browse location link for non-approved create/edit */}
                        {showBrowseLink && browseHref && !needsItemResolution && (
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

                        {/* Source link for delete ops */}
                        {needsItemResolution && !isApproved && itemDetails?.sourceUrl && opType !== "move_item" && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 text-xs"
                                asChild
                            >
                                <Link href={itemDetails.sourceUrl}>
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Browse
                                </Link>
                            </Button>
                        )}

                        {/* For approved moves: link to final location */}
                        {approvedMoveHref && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 text-xs"
                                asChild
                            >
                                <Link href={approvedMoveHref}>
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    View
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
    const [previewDirId, setPreviewDirId] = useState<string | null>(null);
    const [previewPath, setPreviewPath] = useState<string | null>(null);

    // Use applied_result for approved PRs (contains result_browse_path); fall back to payload
    const operations: Record<string, unknown>[] = useMemo(() => {
        if (!pr) return [];
        return pr.status === "approved" && Array.isArray(pr.applied_result) && pr.applied_result.length > 0
            ? pr.applied_result
            : Array.isArray(pr.payload)
                ? pr.payload
                : [pr.payload] as Record<string, unknown>[];
    }, [pr]);

    useEffect(() => {
        if (!pr) return;
        // Find the first operation that points to a real directory
        const findDir = async () => {
            for (const op of operations) {
                const dirId = (op.directory_id ?? op.parent_id) as string | undefined;
                if (dirId && typeof dirId === "string" && !dirId.startsWith("$")) {
                    setPreviewDirId(dirId);
                    return;
                }
            }
        };
        findDir();
    }, [pr, operations]);

    useEffect(() => {
        if (previewDirId) {
            resolveTargetPath(previewDirId).then(info => setPreviewPath(info.url));
        }
    }, [previewDirId]);

    const allItemValues = useMemo(() => operations.map((_, i) => `op-${i}`), [operations]);
    const allExpanded = useMemo(() => expandedItems.length === allItemValues.length, [expandedItems, allItemValues]);

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
            toast.success("Contribution published");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to publish");
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
            toast("Contribution rejected");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to reject");
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
                    <Link href="/pull-requests">← Back to list</Link>
                </Button>
            </div>
        );
    }

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

    const previewUrl = previewPath ? `${previewPath}?preview_pr=${id}` : `/browse?preview_pr=${id}`;

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
                            Rejection reason
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
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-4 flex-1">
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
                        </div>

                        {pr.status === "open" && (
                            <Button variant="outline" size="sm" className="gap-2 shrink-0 border-primary/20 hover:bg-primary/5 hover:text-primary transition-all" asChild>
                                <Link href={previewUrl}>
                                    <Eye className="h-4 w-4" />
                                    <span className="hidden sm:inline">Browse preview</span>
                                    <span className="sm:hidden">Preview</span>
                                </Link>
                            </Button>
                        )}
                    </div>

                    {/* Author + date */}
                    <div className="flex items-center gap-2 text-sm flex-wrap">
                        <Avatar size="sm">
                            <AvatarFallback className="text-[10px]">
                                {initials}
                            </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">
                            {pr.author?.display_name || "[deleted account]"}
                        </span>
                        <span className="text-muted-foreground">
                            submitted{" "}
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
                                        ? `Expires ${formatDistanceToNow(expiresDate, { addSuffix: true })}`
                                        : "Expires in 7 days if not reviewed"}
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
                                Publish
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
                                Reject
                            </Button>
                        </div>
                    </>
                )}
            </div>

            {/* ─── Operations ─────────────────────────── */}
            <div className="overflow-hidden rounded-lg border bg-card">
                <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2.5">
                    <span className="text-sm font-medium text-muted-foreground">
                        Proposed changes
                        <span className="ml-1.5 text-foreground/60">
                            · {operations.length} change
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
                                    Collapse all
                                </>
                            ) : (
                                <>
                                    <ChevronsUpDown className="h-3.5 w-3.5" />
                                    Expand all
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
                        <DialogTitle>Publish this contribution?</DialogTitle>
                        <DialogDescription>
                            {operations.length} change{operations.length !== 1 ? "s" : ""} will be applied permanently.
                            This action cannot be undone.
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
                                + {operations.length - 10} more changes
                            </p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowApproveConfirm(false)}>
                            Cancel
                        </Button>
                        <Button
                            className="bg-green-600 hover:bg-green-700 text-white"
                            onClick={handleApprove}
                        >
                            <Check className="mr-2 h-4 w-4" />
                            Publish
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ─── Reject dialog ──────────────────────── */}
            <Dialog open={showRejectDialog} onOpenChange={(open) => { setShowRejectDialog(open); if (!open) setRejectReason(""); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Reject this contribution</DialogTitle>
                        <DialogDescription>
                            Explain why this contribution is being rejected.
                            This reason will be visible to the author.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Textarea
                            placeholder="E.g. The document is a duplicate, the title is not descriptive enough…"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            rows={4}
                            maxLength={1000}
                            autoFocus
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{rejectReason.trim().length < 10 ? `${10 - rejectReason.trim().length} chars min.` : ""}</span>
                            <span>{rejectReason.length}/1000</span>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setShowRejectDialog(false); setRejectReason(""); }}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={rejectReason.trim().length < 10}
                            onClick={handleReject}
                        >
                            <X className="mr-2 h-4 w-4" />
                            Reject
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
    Download,
    Edit,
    Share2,
    ChevronDown,
    ChevronUp,
    FileText,
    Loader2,
    Trash2,
    Settings,
    Printer,
    Send,
    Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FlagButton } from "@/components/flags/flag-button";
import { EditItemDialog } from "@/components/pr/edit-item-dialog";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";
import { useStagingStore, type Operation } from "@/lib/staging-store";
import { submitDirectOperations } from "@/lib/pr-client";
import { useDownload } from "@/hooks/use-download";
import { usePrint } from "@/hooks/use-print";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface SidebarTarget {
    type: "directory" | "material";
    id: string;
    data: Record<string, unknown>;
}

interface MaterialVersion {
    id: string;
    version_number: number;
    file_name: string | null;
    file_size: number | null;
    diff_summary: string | null;
    author_id: string | null;
    created_at: string;
}

/* -------------------------------------------------------------------------- */
/*  Action group primitive                                                     */
/* -------------------------------------------------------------------------- */

function ActionGroup({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-1.5">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-0.5">
                {label}
            </span>
            <div className="rounded-lg border bg-muted/30 divide-y dark:bg-muted/10">
                {children}
            </div>
        </div>
    );
}

function ActionRow({
    icon: Icon,
    label,
    onClick,
    href,
    destructive = false,
    iconClassName = "",
}: {
    icon: React.ElementType;
    label: string;
    onClick?: () => void;
    href?: string;
    destructive?: boolean;
    iconClassName?: string;
}) {
    const cls = `flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-accent/60 first:rounded-t-lg last:rounded-b-lg ${
        destructive
            ? "text-destructive hover:text-destructive"
            : "text-foreground"
    }`;

    if (href) {
        return (
            <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
                <Icon
                    className={`h-4 w-4 shrink-0 ${iconClassName || (destructive ? "text-destructive" : "text-muted-foreground")}`}
                />
                {label}
            </a>
        );
    }

    return (
        <button onClick={onClick} className={cls}>
            <Icon
                className={`h-4 w-4 shrink-0 ${iconClassName || (destructive ? "text-destructive" : "text-muted-foreground")}`}
            />
            {label}
        </button>
    );
}

/* -------------------------------------------------------------------------- */
/*  Version history                                                            */
/* -------------------------------------------------------------------------- */

function VersionHistoryList({ materialId }: { materialId: string }) {
    const [versions, setVersions] = useState<MaterialVersion[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(false);
    const { downloadMaterial, isDownloading } = useDownload();

    useEffect(() => {
        let mounted = true;
        Promise.resolve().then(() => {
            if (mounted) setLoading(true);
        });
        apiFetch<MaterialVersion[]>(`/materials/${materialId}/versions`)
            .then((data) => {
                if (mounted) setVersions(data);
            })
            .catch(() => {
                if (mounted) setVersions([]);
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });
        return () => {
            mounted = false;
        };
    }, [materialId]);

    if (loading) return <Skeleton className="h-20 w-full rounded-lg" />;
    if (versions.length === 0) {
        return (
            <p className="text-xs text-muted-foreground italic px-1">
                No version history
            </p>
        );
    }

    const visible = expanded ? versions : versions.slice(0, 3);

    return (
        <div className="space-y-1.5">
            {visible.map((v) => (
                <div
                    key={v.id}
                    className="flex items-start gap-2.5 rounded-md border bg-muted/20 px-3 py-2 text-sm dark:bg-muted/10"
                >
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5">
                            <span className="font-medium">
                                v{v.version_number}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {new Date(v.created_at).toLocaleDateString()}
                            </span>
                        </div>
                        {v.diff_summary && (
                            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                                {v.diff_summary}
                            </p>
                        )}
                    </div>
                    <button
                        onClick={() => downloadMaterial(materialId, v.version_number)}
                        disabled={isDownloading}
                        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                        title={`Download v${v.version_number}`}
                    >
                        {isDownloading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Download className="h-3.5 w-3.5" />
                        )}
                    </button>
                </div>
            ))}
            {versions.length > 3 && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(!expanded)}
                    className="w-full text-xs"
                >
                    {expanded ? (
                        <>
                            <ChevronUp className="mr-1 h-3 w-3" /> Show less
                        </>
                    ) : (
                        <>
                            <ChevronDown className="mr-1 h-3 w-3" /> Show all (
                            {versions.length})
                        </>
                    )}
                </Button>
            )}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Main export                                                                */
/* -------------------------------------------------------------------------- */

interface ActionsTabProps {
    target: SidebarTarget | null;
}

export function ActionsTab({ target }: ActionsTabProps) {
    const router = useRouter();
    const addOperation = useStagingStore((s) => s.addOperation);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    
    // Delete Confirmation State
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const { downloadMaterial, isDownloading } = useDownload();
    
    // Derive print capability early for unconditional hook call
    const isMaterial = target?.type === "material";
    const materialId = isMaterial ? target?.id : "";
    const viewerType = String(target?.data?.__viewerType ?? "");
    const versionInfo = target?.data?.current_version_info as Record<string, unknown> | null;
    const fileName = String(versionInfo?.file_name ?? "");
    const mimeType = String(versionInfo?.file_mime_type ?? "");

    const { print, isPrinting, canPrint } = usePrint({
        viewerType,
        materialId: materialId ?? "",
        fileName,
        mimeType,
    });

    if (!target) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center">
                <Settings className="mb-3 h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                    Select an item to view actions.
                </p>
            </div>
        );
    }

    const title = String(isMaterial ? target.data.title ?? "item" : target.data.name ?? "folder");

    const getDeleteOp = (): Operation => {
        if (isMaterial) {
            return { op: "delete_material", material_id: target.id };
        } else {
            return { op: "delete_directory", directory_id: target.id };
        }
    };

    const handleShare = () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            toast.success("Link copied to clipboard");
        });
    };

    const handleDraftDelete = () => {
        addOperation(getDeleteOp());
        toast.success(`Suppression de "${title}" ajoutée au brouillon`);
        setDeleteDialogOpen(false);
    };

    const handleDirectDelete = async () => {
        setDeleting(true);
        const result = await submitDirectOperations([getDeleteOp()]);
        setDeleting(false);
        setDeleteDialogOpen(false);
        if (result?.status === "approved") {
            router.refresh();
        }
    };

    return (
        <div className="space-y-4">
            {/* Quick actions */}
            <ActionGroup label="Actions Rapides">
                {isMaterial && materialId && (
                    <ActionRow
                        icon={isDownloading ? Loader2 : Download}
                        label="Télécharger"
                        onClick={() => downloadMaterial(materialId)}
                        iconClassName={isDownloading ? "animate-spin" : ""}
                    />
                )}
                {isMaterial && canPrint && (
                    <ActionRow
                        icon={isPrinting ? Loader2 : Printer}
                        label="Imprimer"
                        onClick={print}
                        iconClassName={isPrinting ? "animate-spin" : ""}
                    />
                )}
                <ActionRow
                    icon={Share2}
                    label="Copier le lien"
                    onClick={handleShare}
                />
            </ActionGroup>

            {/* Editing */}
            <ActionGroup label="Organisation">
                <ActionRow
                    icon={Edit}
                    label="Modifier les détails"
                    onClick={() => setEditDialogOpen(true)}
                />
                <ActionRow
                    icon={Trash2}
                    label="Supprimer"
                    onClick={() => setDeleteDialogOpen(true)}
                    destructive
                />
            </ActionGroup>

            {/* Moderation */}
            <ActionGroup label="Modération">
                <FlagButton
                    targetType={isMaterial ? "material" : "comment"}
                    targetId={target.id}
                    variant="ghost"
                    className="flex w-full items-center justify-start gap-2.5 px-3 py-2.5 text-sm font-normal rounded-lg hover:bg-accent/60"
                    iconClassName="h-4 w-4 text-muted-foreground"
                />
            </ActionGroup>

            {/* Version history */}
            {isMaterial && materialId && (
                <div className="space-y-1.5">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-0.5">
                        Historique
                    </span>
                    <VersionHistoryList materialId={materialId} />
                </div>
            )}

            <EditItemDialog
                open={editDialogOpen}
                onOpenChange={setEditDialogOpen}
                target={target}
            />

            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <Trash2 className="h-5 w-5" />
                            Supprimer {isMaterial ? "le document" : "le dossier"}
                        </DialogTitle>
                        <DialogDescription>
                            Voulez-vous supprimer définitivement{" "}
                            <span className="font-medium text-foreground">{title}</span> ?
                            Vous pouvez proposer cette suppression immédiatement ou l'ajouter à votre brouillon global.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0 mt-4">
                        <Button
                            variant="ghost"
                            onClick={() => setDeleteDialogOpen(false)}
                            disabled={deleting}
                            className="sm:mr-auto"
                        >
                            Annuler
                        </Button>
                        <Button
                            variant="outline"
                            onClick={handleDraftDelete}
                            disabled={deleting}
                            className="gap-2 border-dashed border-destructive/50 text-destructive hover:bg-destructive/10"
                        >
                            <Plus className="h-4 w-4" />
                            Brouillon
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDirectDelete}
                            disabled={deleting}
                            className="gap-2"
                        >
                            {deleting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Send className="h-4 w-4" />
                            )}
                            Supprimer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

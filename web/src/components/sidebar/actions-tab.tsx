"use client";

import { useEffect, useState } from "react";
import {
    Download,
    Edit,
    Share2,
    History,
    Printer,
    ChevronDown,
    ChevronUp,
    FileText,
    Trash2,
    Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FlagButton } from "@/components/flags/flag-button";
import { EditItemDialog } from "@/components/pr/edit-item-dialog";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";
import { printBlobUrl } from "@/lib/file-utils";
import { useStagingStore } from "@/lib/staging-store";

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

    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

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
                    <a
                        href={`${apiBase}/materials/${materialId}/versions/${v.version_number}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        title={`Download v${v.version_number}`}
                    >
                        <Download className="h-3.5 w-3.5" />
                    </a>
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
    const addOperation = useStagingStore((s) => s.addOperation);
    const [editDialogOpen, setEditDialogOpen] = useState(false);

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

    const isMaterial = target.type === "material";
    const materialId = isMaterial ? target.id : null;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

    const handleShare = () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            toast.success("Link copied to clipboard");
        });
    };

    const handlePrint = async () => {
        if (!materialId) {
            window.print();
            return;
        }
        try {
            const res = await fetch(
                `${apiBase}/materials/${materialId}/file`,
                { credentials: "include" }
            );
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            printBlobUrl(url, blob.type);
        } catch {
            window.print();
        }
    };

    const handleDelete = () => {
        if (isMaterial) {
            addOperation({
                op: "delete_material",
                material_id: target.id,
            });
            toast.success(
                `Deletion of "${String(target.data.title ?? "item")}" staged`
            );
        } else {
            addOperation({
                op: "delete_directory",
                directory_id: target.id,
            });
            toast.success(
                `Deletion of folder "${String(target.data.name ?? "folder")}" staged`
            );
        }
    };

    return (
        <div className="space-y-4">
            {/* Quick actions */}
            <ActionGroup label="Quick Actions">
                {isMaterial && (
                    <ActionRow
                        icon={Download}
                        label="Download"
                        href={`${apiBase}/materials/${materialId}/download`}
                    />
                )}
                <ActionRow
                    icon={Share2}
                    label="Copy link"
                    onClick={handleShare}
                />
                {isMaterial && (
                    <ActionRow
                        icon={Printer}
                        label="Print"
                        onClick={handlePrint}
                    />
                )}
            </ActionGroup>

            {/* Editing */}
            <ActionGroup label="Editing">
                <ActionRow
                    icon={Edit}
                    label="Edit (stage change)"
                    onClick={() => setEditDialogOpen(true)}
                />
                <ActionRow
                    icon={Trash2}
                    label="Delete (stage)"
                    onClick={handleDelete}
                    destructive
                />
            </ActionGroup>

            {/* Moderation */}
            <ActionGroup label="Moderation">
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
                        Version History
                    </span>
                    <VersionHistoryList materialId={materialId} />
                </div>
            )}

            <EditItemDialog
                open={editDialogOpen}
                onOpenChange={setEditDialogOpen}
                target={target}
            />
        </div>
    );
}

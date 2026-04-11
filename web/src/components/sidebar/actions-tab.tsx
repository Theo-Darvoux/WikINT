"use client";

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FlagButton } from "@/components/flags/flag-button";
import { FileEditDialog } from "@/components/pr/file-edit-dialog";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";
import { useStagingStore, type Operation } from "@/lib/staging-store";
import { submitDirectOperations } from "@/lib/pr-client";
import { useDownload } from "@/hooks/use-download";
import { usePrint } from "@/hooks/use-print";
import { useBrowseRefreshStore } from "@/lib/stores";
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
    destructive ? "text-destructive hover:text-destructive" : "text-foreground"
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

  if (loading) return <Skeleton className="h-24 w-full rounded-lg" />;
  if (versions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic px-1">
        No version history available.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {versions.map((v) => (
        <div
          key={v.id}
          className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5 text-sm dark:bg-muted/5 hover:bg-muted/30 transition-colors"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background border shadow-sm">
            <span className="text-[10px] font-bold">v{v.version_number}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-col">
              <span className="text-xs font-medium text-muted-foreground">
                {new Date(v.created_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          </div>
          <button
            onClick={() => downloadMaterial(materialId, v.version_number)}
            disabled={isDownloading}
            className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-all hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
            title={`Download v${v.version_number}`}
          >
            {isDownloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </button>
        </div>
      ))}
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
  const triggerBrowseRefresh = useBrowseRefreshStore(
    (s) => s.triggerBrowseRefresh,
  );
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
  const versionInfo = target?.data?.current_version_info as Record<
    string,
    unknown
  > | null;
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
      <div className="flex flex-col items-center justify-center py-20 p-8 text-center">
        <Settings className="mb-3 h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">
          Select an item to view actions.
        </p>
      </div>
    );
  }

  const title = String(
    isMaterial ? (target.data.title ?? "item") : (target.data.name ?? "folder"),
  );

  const getDeleteOp = (): Operation => {
    if (isMaterial) {
      return { op: "delete_material", material_id: target.id };
    } else {
      return { op: "delete_directory", directory_id: target.id };
    }
  };

  const handleShare = async () => {
    let path = "";
    if (isMaterial) {
      const dirPath = String(target.data.directory_path ?? "");
      const slug = String(target.data.slug ?? "");
      path = dirPath ? `${dirPath}/${slug}` : slug;
    } else {
      path = String(target.data.full_path ?? target.data.slug ?? "");
    }

    const shareUrl = `${window.location.origin}/browse/${path}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title,
          url: shareUrl,
        });
      } catch (err) {
        // Only show error if it's not a user cancellation
        if (err instanceof Error && err.name !== "AbortError") {
          toast.error("Sharing failed");
        }
      }
    } else {
      navigator.clipboard.writeText(shareUrl).then(() => {
        toast.success("Link copied to clipboard");
      });
    }
  };

  const handleDraftDelete = () => {
    addOperation(getDeleteOp());
    toast.success(`Deletion of "${title}" added to draft`);
    setDeleteDialogOpen(false);
  };

  const handleDirectDelete = async () => {
    setDeleting(true);
    const result = await submitDirectOperations([getDeleteOp()]);
    setDeleting(false);
    setDeleteDialogOpen(false);
    if (result?.status === "approved") {
      triggerBrowseRefresh();
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="shrink-0 p-4 space-y-6">
        {/* Quick actions */}
        <ActionGroup label="Quick Actions">
          {isMaterial && materialId && (
            <ActionRow
              icon={isDownloading ? Loader2 : Download}
              label="Download"
              onClick={() => downloadMaterial(materialId)}
              iconClassName={isDownloading ? "animate-spin" : ""}
            />
          )}
          {isMaterial && canPrint && (
            <ActionRow
              icon={isPrinting ? Loader2 : Printer}
              label="Print"
              onClick={print}
              iconClassName={isPrinting ? "animate-spin" : ""}
            />
          )}
          <ActionRow icon={Share2} label="Copy Link" onClick={handleShare} />
        </ActionGroup>

        {/* Editing */}
        <ActionGroup label="Organization">
          <ActionRow
            icon={Edit}
            label="Edit Details"
            onClick={() => setEditDialogOpen(true)}
          />
          <ActionRow
            icon={Trash2}
            label="Delete Item"
            onClick={() => setDeleteDialogOpen(true)}
            destructive
          />
        </ActionGroup>

        {/* Moderation */}
        <ActionGroup label="Moderation">
          <FlagButton
            targetType={isMaterial ? "material" : "comment"}
            targetId={target.id}
            variant="ghost"
            className="flex w-full items-center justify-start gap-2.5 px-3 py-2.5 text-sm font-normal rounded-lg hover:bg-accent/60 transition-colors"
            iconClassName="h-4 w-4 text-muted-foreground"
          />
        </ActionGroup>
      </div>

      {/* Version history */}
      {isMaterial && materialId && (
        <div className="flex flex-1 min-h-0 flex-col px-4 pb-4">
          <span className="mb-3 block shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-0.5">
            Version History
          </span>
          <ScrollArea className="flex-1">
            <div className="pb-4">
              <VersionHistoryList materialId={materialId} />
            </div>
          </ScrollArea>
        </div>
      )}

      <FileEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        target={target}
      />

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete {isMaterial ? "Material" : "Folder"}
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete{" "}
              <span className="font-semibold text-foreground">{title}</span>?
              You can propose this deletion immediately or add it to your global
              staging draft.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 mt-6">
            <Button
              variant="ghost"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
              className="sm:mr-auto"
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={handleDraftDelete}
              disabled={deleting}
              className="gap-2 border-dashed border-destructive/40 text-destructive hover:bg-destructive/5 hover:border-destructive/60"
            >
              <Plus className="h-4 w-4" />
              Draft
            </Button>
            <Button
              variant="destructive"
              onClick={handleDirectDelete}
              disabled={deleting}
              className="gap-2 shadow-sm"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Delete Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

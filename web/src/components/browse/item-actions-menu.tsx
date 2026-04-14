"use client";

import React, { createContext, useContext, useState } from "react";
import {
  MoreVertical,
  Download,
  Printer,
  Edit,
  Trash2,
  Plus,
  Send,
  Loader2,
  Share2,
  Paperclip,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useDownload } from "@/hooks/use-download";
import { usePrint } from "@/hooks/use-print";
import { useStagingStore, unwrapOp } from "@/lib/staging-store";
import { submitDirectOperations } from "@/lib/pr-client";
import { useBrowseRefreshStore } from "@/lib/stores";
import { FileEditDialog } from "@/components/pr/file-edit-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FlagButton } from "@/components/flags/flag-button";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ItemData = {
  id: string;
  type: "directory" | "material";
  data: Record<string, unknown>;
  staged?: "edited" | "deleted" | "moved" | "created" | null;
  isExternal?: boolean;
};

interface ActionsContextValue {
  item: ItemData;
  actions: ReturnType<typeof useItemActions>;
  onAddAttachment?: () => void;
}

const ActionsContext = createContext<ActionsContextValue | null>(null);

// ─── Logic Hook ───────────────────────────────────────────────────────────────

function useItemActions(item: ItemData) {
  const triggerBrowseRefresh = useBrowseRefreshStore((s) => s.triggerBrowseRefresh);
  const { addOperation, operations, removeOperation } = useStagingStore();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isMaterial = item.type === "material";
  const title = String(isMaterial ? (item.data.title ?? "") : (item.data.name ?? ""));
  const viewerType = String(item.data.type || "");
  const mimeType = String(item.data.mime_type || "");

  const handleDraftDelete = () => {
    // If this is already a staged creation, "deleting" it means just removing the creation op
    if (item.staged === "created" && !item.isExternal) {
        // Find index of the creation op for this temp id
        const idx = operations.findIndex(o => {
            const unwrapped = unwrapOp(o);
            if (item.type === "directory") {
                return unwrapped.op === "create_directory" && unwrapped.temp_id === item.id;
            } else {
                return unwrapped.op === "create_material" && unwrapped.temp_id === item.id;
            }
        });
        if (idx !== -1) {
            removeOperation(idx);
            toast.success("Creation cancelled and removed from draft");
        }
    } else {
        if (isMaterial) {
            addOperation({
                op: "delete_material",
                material_id: item.id,
            });
        } else {
            addOperation({
                op: "delete_directory",
                directory_id: item.id,
            });
        }
        toast.success("Added deletion to current draft");
    }
    setDeleteDialogOpen(false);
  };

  const handleDirectDelete = async () => {
    setDeleting(true);
    try {
      await submitDirectOperations([
        isMaterial ? {
          op: "delete_material",
          material_id: item.id,
        } : {
          op: "delete_directory",
          directory_id: item.id,
        },
      ]);
      toast.success(`${isMaterial ? "Material" : "Folder"} deleted successfully`);
      setDeleteDialogOpen(false);
      triggerBrowseRefresh();
    } catch {
      toast.error("Failed to delete item");
    } finally {
      setDeleting(false);
    }
  };

  const { downloadMaterial, isDownloading } = useDownload();
  const { print, isPrinting, canPrint } = usePrint({
    viewerType,
    materialId: item.id,
    fileName: title,
    mimeType,
  });

  const handleShare = () => {
    const url = window.location.href; // In real app, we might want a specific item link
    navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  };

  return {
    title,
    isMaterial,
    viewerType,
    mimeType,
    deleteDialogOpen,
    setDeleteDialogOpen,
    editDialogOpen,
    setEditDialogOpen,
    deleting,
    handleDraftDelete,
    handleDirectDelete,
    handleShare,
    downloadMaterial,
    isDownloading,
    print,
    isPrinting,
    canPrint,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MenuItemsList({ isContextMenu = false }: { isContextMenu?: boolean }) {
  const context = useContext(ActionsContext);
  if (!context) return null;
  const { item, actions } = context;

  const Item = isContextMenu ? ContextMenuItem : DropdownMenuItem;
  const Separator = isContextMenu ? ContextMenuSeparator : DropdownMenuSeparator;
  const Label = isContextMenu ? ContextMenuLabel : DropdownMenuLabel;

  const { downloadMaterial, isDownloading, print, isPrinting, canPrint } = actions;

  const isStaged = !!item.staged;
  const isCreated = item.staged === "created";

  return (
    <>
      <Label className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
        {actions.isMaterial ? "Material Actions" : "Folder Actions"}
      </Label>
      
      {actions.isMaterial && !isCreated && (
        <>
          <Item 
            onClick={() => downloadMaterial(item.id)} 
            disabled={isDownloading}
            className="cursor-pointer"
          >
            {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            <span>Download</span>
          </Item>
          {canPrint && (
            <Item 
              onClick={() => print()} 
              disabled={isPrinting}
              className="cursor-pointer"
            >
              {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
              <span>Print</span>
            </Item>
          )}
          {context.onAddAttachment && (
            <Item onClick={context.onAddAttachment} className="cursor-pointer">
              <Paperclip className="mr-2 h-4 w-4" />
              <span>Add Attachment</span>
            </Item>
          )}
          <Separator />
        </>
      )}

      {!isCreated && (
        <>
          <Item onClick={() => actions.setEditDialogOpen(true)} className="cursor-pointer">
            <Edit className="mr-2 h-4 w-4" />
            <span>Edit Metadata</span>
          </Item>
          <Item onClick={actions.handleShare} className="cursor-pointer">
            <Share2 className="mr-2 h-4 w-4" />
            <span>Copy Link</span>
          </Item>
        </>
      )}

      {actions.isMaterial && !isStaged && (
        <div onClick={(e) => e.stopPropagation()}>
          <FlagButton
            targetType="material"
            targetId={item.id}
            variant="ghost"
            className="flex w-full items-center justify-start gap-2.5 px-2 py-1.5 text-sm font-normal rounded-sm hover:bg-accent transition-colors h-auto"
            iconClassName="h-4 w-4 text-muted-foreground mr-0.5"
          />
        </div>
      )}

      <Separator />

      <Item 
        onClick={() => actions.setDeleteDialogOpen(true)}
        variant="destructive"
        className="cursor-pointer"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        <span>{isCreated ? "Discard Draft" : "Delete"}</span>
      </Item>
    </>
  );
}

// ─── Main Components ──────────────────────────────────────────────────────────

export function ItemActionsMenu({
  item,
  children,
  onAddAttachment,
}: {
  item: ItemData;
  children: React.ReactNode;
  onAddAttachment?: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { staged, isExternal, ...rest } = item;
  const actions = useItemActions(item);

  return (
    <ActionsContext.Provider value={{ item, actions, onAddAttachment }}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <MenuItemsList isContextMenu />
        </ContextMenuContent>
      </ContextMenu>

      {!item.isExternal && (
        <FileEditDialog
            open={actions.editDialogOpen}
            onOpenChange={actions.setEditDialogOpen}
            target={{ type: item.type, id: item.id, data: item.data }}
        />
      )}

      <Dialog open={actions.deleteDialogOpen} onOpenChange={actions.setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              {item.staged === "created" ? "Discard Draft" : `Delete ${actions.isMaterial ? "Material" : "Folder"}`}
            </DialogTitle>
            <DialogDescription>
              {item.staged === "created" 
                ? `Are you sure you want to discard this staged ${item.type}? All unsaved changes will be lost.`
                : <>Are you sure you want to permanently delete <span className="font-semibold text-foreground">{actions.title}</span>?</>
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 mt-6">
            <Button variant="ghost" onClick={() => actions.setDeleteDialogOpen(false)} disabled={actions.deleting} className="sm:mr-auto">
              Cancel
            </Button>
            
            {item.staged !== "created" && (
                <Button
                    variant="outline"
                    onClick={actions.handleDraftDelete}
                    disabled={actions.deleting}
                    className="gap-2 border-dashed border-destructive/40 text-destructive hover:bg-destructive/5 hover:border-destructive/60"
                >
                    <Plus className="h-4 w-4" />
                    Draft
                </Button>
            )}

            <Button 
                variant="destructive" 
                onClick={item.staged === "created" ? actions.handleDraftDelete : actions.handleDirectDelete} 
                disabled={actions.deleting} 
                className="gap-2 shadow-sm"
            >
              {actions.deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : (item.staged === "created" ? <Trash2 className="h-4 w-4" /> : <Send className="h-4 w-4" />)}
              {item.staged === "created" ? "Discard" : "Delete Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ActionsContext.Provider>
  );
}

export function ItemActionsDropdownTrigger() {
  const context = useContext(ActionsContext);
  if (!context) return null;

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 hover:bg-muted active:scale-95 transition-transform"
          >
            <MoreVertical className="h-4 w-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <MenuItemsList />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

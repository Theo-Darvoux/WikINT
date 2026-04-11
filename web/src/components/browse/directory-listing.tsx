"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DirectoryLineItem } from "@/components/browse/directory-line-item";
import { MaterialLineItem } from "@/components/browse/material-line-item";
import { Breadcrumbs } from "@/components/browse/breadcrumbs";
import { EmptyDirectory } from "@/components/browse/empty-directory";
import { UploadDrawer } from "@/components/pr/upload-drawer";
import { NewFolderDialog } from "@/components/pr/new-folder-dialog";
import { DirectoryOpenPRs } from "@/components/browse/directory-open-prs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { submitDirectOperations } from "@/lib/pr-client";
import { useBrowseRefreshStore } from "@/lib/stores";
import {
  Plus,
  Upload,
  FolderPlus,
  FileText,
  Folder,
  ArrowLeft,
  Paperclip,
  UploadCloud,
  CheckSquare,
  X,
  Trash2,
  Scissors,
  ClipboardPaste,
  Loader2,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { useStagingStore } from "@/lib/staging-store";
import { useIsMobile } from "@/hooks/use-media-query";
import { unwrapOp } from "@/lib/staging-store";
import { useDropZoneStore } from "@/components/pr/global-drop-zone";
import { useSelectionStore } from "@/lib/selection-store";
import type {
  CreateMaterialOp,
  CreateDirectoryOp,
  MoveItemOp,
  Operation,
  StagedOperation,
} from "@/lib/staging-store";
import type { SelectedItem } from "@/lib/selection-store";

/** Check if a real item has any staged edit/delete/move targeting it */
function stagedStatus(
  ops: (StagedOperation | Operation)[],
  id: string,
  kind: "directory" | "material",
): "edited" | "deleted" | "moved" | null {
  for (const staged of ops) {
    const op = unwrapOp(staged as StagedOperation);
    if (kind === "directory") {
      if (op.op === "delete_directory" && op.directory_id === id)
        return "deleted";
      if (op.op === "edit_directory" && op.directory_id === id) return "edited";
    } else {
      if (op.op === "delete_material" && op.material_id === id)
        return "deleted";
      if (op.op === "edit_material" && op.material_id === id) return "edited";
    }
    if (op.op === "move_item" && op.target_type === kind && op.target_id === id)
      return "moved";
  }
  return null;
}

interface DirectoryListingProps {
  directory: Record<string, unknown> | null;
  directories: Record<string, unknown>[];
  materials: Record<string, unknown>[];
  breadcrumbs?: { id: string; name: string; slug: string }[];
  isAttachmentListing?: boolean;
  /** The parent material when viewing its attachments */
  parentMaterial?: Record<string, unknown> | null;
  /** Operations from a PR being previewed */
  previewOperations?: Operation[];
  /** PR id when in preview mode — used to link blue ghost files to the preview page */
  previewPrId?: string;
}

/** Represents a staged directory the user has navigated into */
interface GhostDirEntry {
  tempId: string;
  name: string;
}

type AugmentedOp = Operation & {
  isExternal: boolean;
  _previewIdx: number | undefined;
};

export function DirectoryListing({
  directory,
  directories,
  materials,
  breadcrumbs = [],
  isAttachmentListing = false,
  parentMaterial = null,
  previewOperations = [],
  previewPrId,
}: DirectoryListingProps) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const pathname = usePathname();
  const triggerBrowseRefresh = useBrowseRefreshStore(
    (s) => s.triggerBrowseRefresh,
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const requestUpload = useDropZoneStore((s) => s.requestUpload);
  const setBrowseContext = useDropZoneStore((s) => s.setBrowseContext);

  // Stack of ghost dirs the user has navigated into (supports nesting)
  const [ghostDirStack, setGhostDirStack] = useState<GhostDirEntry[]>([]);
  const activeGhostDir =
    ghostDirStack.length > 0 ? ghostDirStack[ghostDirStack.length - 1] : null;

  const operations = useStagingStore((s) => s.operations) ?? [];
  const addOperations = useStagingStore((s) => s.addOperations);
  const setReviewOpen = useStagingStore((s) => s.setReviewOpen);

  // Merge logic: local operations take precedence over preview operations
  const allOps = useMemo(() => {
    const local = operations.map((s) => unwrapOp(s));
    // We only want preview ops that don't conflict with local edits on the same target.
    // Preserve the original payload index (_previewIdx) so ghost materials can link
    // to /pull-requests/{prId}/preview/{opIndex}.
    const external = (previewOperations ?? [])
      .map((op, idx) => ({ op, idx }))
      .filter(({ op: externalOp }) => {
        if (
          externalOp.op === "edit_directory" ||
          externalOp.op === "delete_directory"
        ) {
          return !local.some(
            (l) =>
              (l.op === "edit_directory" || l.op === "delete_directory") &&
              l.directory_id === externalOp.directory_id,
          );
        }
        if (
          externalOp.op === "edit_material" ||
          externalOp.op === "delete_material"
        ) {
          return !local.some(
            (l) =>
              (l.op === "edit_material" || l.op === "delete_material") &&
              l.material_id === externalOp.material_id,
          );
        }
        return true; // creates/moves are merged additive
      })
      .map(({ op, idx }) => ({ ...op, isExternal: true, _previewIdx: idx }));

    return [
      ...local.map((op) => ({
        ...op,
        isExternal: false,
        _previewIdx: undefined as number | undefined,
      })),
      ...external,
    ];
  }, [operations, previewOperations]);

  // Selection / batch operations
  const selectMode = useSelectionStore((s) => s.selectMode);
  const selected = useSelectionStore((s) => s.selected);
  const clipboard = useSelectionStore((s) => s.clipboard);
  const setSelectMode = useSelectionStore((s) => s.setSelectMode);
  const toggleSelect = useSelectionStore((s) => s.toggle);
  const selectAll = useSelectionStore((s) => s.selectAll);
  const deselectAll = useSelectionStore((s) => s.deselectAll);
  const cutRaw = useSelectionStore((s) => s.cut);
  const clearClipboard = useSelectionStore((s) => s.clearClipboard);

  // When viewing a ghost dir, the effective id/name come from the ghost entry
  const realDirId = directory?.id ? String(directory.id) : null;
  const realDirName = directory?.name ? String(directory.name) : "Root";
  const dirId = activeGhostDir ? activeGhostDir.tempId : realDirId;
  const dirName = activeGhostDir ? activeGhostDir.name : realDirName;

  // Keep the global drop-zone store in sync with the effective directory
  useEffect(() => {
    setBrowseContext({ directoryId: dirId || "", directoryName: dirName });
    return () => setBrowseContext(null);
  }, [dirId, dirName, setBrowseContext]);

  // Ghost items: staged creates targeting the current effective directory.
  // At root, dirId is "" but parent_id is null — treat both as "root".
  const isRoot = !dirId;
  const ghostDirs = allOps.filter((op) => {
    if (
      op.op === "create_directory" &&
      (isRoot ? !op.parent_id : op.parent_id === dirId)
    )
      return true;
    if (op.op === "move_item" && op.target_type === "directory") {
      const isTarget = isRoot ? !op.new_parent_id : op.new_parent_id === dirId;
      return isTarget;
    }
    return false;
  }) as (AugmentedOp & (CreateDirectoryOp | MoveItemOp))[];

  const ghostMaterials = allOps.filter((op) => {
    if (op.op === "create_material") {
      const isCreatedHere = isAttachmentListing
        ? op.parent_material_id === (parentMaterial?.id as string)
        : isRoot
          ? !op.directory_id
          : op.directory_id === dirId;
      if (isCreatedHere) return true;
    }

    if (op.op === "move_item" && op.target_type === "material") {
      const isTarget = isAttachmentListing
        ? op.new_parent_id === (parentMaterial?.id as string)
        : isRoot
          ? !op.new_parent_id
          : op.new_parent_id === dirId;
      return isTarget;
    }
    return false;
  }) as (AugmentedOp & (CreateMaterialOp | MoveItemOp))[];

  // When inside a ghost dir, there are no real items
  const effectiveDirs = useMemo(
    () => (activeGhostDir ? [] : directories),
    [activeGhostDir, directories],
  );
  const effectiveMats = useMemo(
    () => (activeGhostDir ? [] : materials),
    [activeGhostDir, materials],
  );

  const sortedDirs = useMemo(() => {
    return [...effectiveDirs].sort((a, b) =>
      String(a.name ?? "").localeCompare(String(b.name ?? "")),
    );
  }, [effectiveDirs]);

  const sortedMats = useMemo(() => {
    return [...effectiveMats].sort((a, b) =>
      String(a.title ?? "").localeCompare(String(b.title ?? "")),
    );
  }, [effectiveMats]);

  const isEmpty =
    effectiveDirs.length === 0 &&
    effectiveMats.length === 0 &&
    ghostDirs.length === 0 &&
    ghostMaterials.length === 0;

  const enterGhostDir = (tempId: string, name: string) => {
    setGhostDirStack((prev) => [...prev, { tempId, name }]);
    setShowActions(false);
  };

  const goBack = () => {
    setGhostDirStack((prev) => prev.slice(0, -1));
    setShowActions(false);
  };

  // Keyboard navigation
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const focusedIndexRef = useRef<number | null>(null);
  focusedIndexRef.current = focusedIndex;

  // Build a flat ordered list mirroring the render order for arrow-key nav
  type NavItem =
    | { type: "dir"; dir: Record<string, unknown> }
    | { type: "ghost-dir"; tempId: string; name: string }
    | { type: "mat"; mat: Record<string, unknown> }
    | { type: "ghost-mat"; op: AugmentedOp & (CreateMaterialOp | MoveItemOp) };

  const flatItems = useMemo<NavItem[]>(
    () => [
      ...sortedDirs.map((dir) => ({ type: "dir" as const, dir })),
      ...ghostDirs.map((op) => ({
        type: "ghost-dir" as const,
        tempId:
          (op.op === "create_directory" ? op.temp_id : op.target_id) || "",
        name:
          (op.op === "create_directory" ? op.name : op.target_name) ||
          "Unnamed",
      })),
      ...sortedMats.map((mat) => ({ type: "mat" as const, mat })),
      ...ghostMaterials.map((op) => ({ type: "ghost-mat" as const, op })),
    ],
    [sortedDirs, ghostDirs, sortedMats, ghostMaterials],
  );

  // Reset focus when directory changes
  useEffect(() => {
    setFocusedIndex(null);
  }, [directory?.id]);

  // Build path helper (mirrors logic in line-item components)
  const pathBase = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const buildItemPath = (slug: string) =>
    previewPrId
      ? `${pathBase}/${slug}?preview_pr=${previewPrId}`
      : `${pathBase}/${slug}`;

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex === null) return;
    document
      .querySelector(`[data-nav-index="${focusedIndex}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIndex]);

  // Keydown handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't hijack events from inputs / modals
      const tag = (e.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if ((e.target as HTMLElement).isContentEditable) return;
      if (selectMode) return;
      if (flatItems.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) =>
          prev === null ? 0 : Math.min(prev + 1, flatItems.length - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) =>
          prev === null ? flatItems.length - 1 : Math.max(prev - 1, 0),
        );
      } else if (e.key === "Enter") {
        const idx = focusedIndexRef.current;
        if (idx === null) return;
        const item = flatItems[idx];
        if (!item) return;
        e.preventDefault();
        if (item.type === "dir") {
          router.push(buildItemPath(String(item.dir.slug ?? "")));
        } else if (item.type === "ghost-dir") {
          enterGhostDir(item.tempId, item.name);
        } else if (item.type === "mat") {
          router.push(buildItemPath(String(item.mat.slug ?? "")));
        } else if (item.type === "ghost-mat") {
          const op = item.op;
          if (op.isExternal && previewPrId && op._previewIdx !== undefined) {
            router.push(
              `/pull-requests/${previewPrId}/preview/${op._previewIdx}`,
            );
          } else {
            setReviewOpen(true);
          }
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatItems, selectMode, router, pathBase, previewPrId]);

  // Build the full list of selectable real items for "select all"
  const allSelectableItems: SelectedItem[] = [
    ...effectiveDirs.map((d) => ({
      id: String(d.id),
      type: "directory" as const,
      name: String(d.name ?? ""),
      parentId: dirId || null,
    })),
    ...effectiveMats.map((m) => ({
      id: String(m.id),
      type: "material" as const,
      name: String(m.title ?? ""),
      parentId: dirId || null,
      material_type: String(m.type ?? "other"),
    })),
  ];

  const selectedCount = selected.size;
  const allSelected =
    allSelectableItems.length > 0 &&
    allSelectableItems.every((item) => selected.has(item.id));

  const [batchDeleteOps, setBatchDeleteOps] = useState<Operation[] | null>(
    null,
  );
  const [batchPasteOps, setBatchPasteOps] = useState<Operation[] | null>(null);
  const [submittingBatch, setSubmittingBatch] = useState(false);

  const handleBatchDelete = () => {
    const ops: Operation[] = [];
    let skipped = 0;
    for (const item of selected.values()) {
      // Skip if this item already has a staged delete or move
      const existing = stagedStatus(operations, item.id, item.type);
      if (existing === "deleted") {
        skipped++;
        continue;
      }
      if (item.type === "directory") {
        ops.push({ op: "delete_directory", directory_id: item.id });
      } else {
        ops.push({ op: "delete_material", material_id: item.id });
      }
    }
    if (ops.length === 0) {
      toast.info("All selected items are already staged for deletion");
      setSelectMode(false);
      return;
    }
    setBatchDeleteOps(ops);
  };

  const handleCut = () => {
    // Warn if any selected items are already staged for deletion
    let hasConflict = false;
    for (const item of selected.values()) {
      if (stagedStatus(operations, item.id, item.type) === "deleted") {
        hasConflict = true;
        break;
      }
    }
    if (hasConflict) {
      toast.error(
        "Some selected items are already staged for deletion — remove the delete first",
      );
      return;
    }
    cutRaw();
    toast.success(
      `${selected.size} item${selected.size !== 1 ? "s" : ""} cut — navigate to target folder and paste`,
    );
  };

  // IDs of the current directory and all its ancestors — used to prevent
  // pasting a folder into itself or any of its descendants.
  const ancestorIds = new Set([dirId, ...breadcrumbs.map((b) => b.id)]);

  const handlePaste = () => {
    const targetParent = dirId || null;
    // Filter out circular moves and no-op moves (already in this directory)
    const safe = clipboard.filter((item) => {
      if (item.type === "directory" && ancestorIds.has(item.id)) return false;
      if (item.parentId === targetParent) return false;
      return true;
    });

    if (safe.length === 0) {
      const allSameParent = clipboard.every((i) => i.parentId === targetParent);
      toast.error(
        allSameParent
          ? "Items are already in this folder"
          : "Cannot move a folder into itself or its own subfolder",
      );
      return;
    }

    const ops: Operation[] = safe.map((item) => ({
      op: "move_item" as const,
      target_type: item.type,
      target_id: item.id,
      new_parent_id: targetParent,
      ...(item.type === "directory"
        ? { target_name: item.name }
        : {
            target_title: item.name,
            target_material_type: item.material_type || "other",
          }),
    }));
    setBatchPasteOps(ops);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex-1 space-y-1">
          {breadcrumbs.length > 0 && !activeGhostDir && (
            <Breadcrumbs items={breadcrumbs} previewPrId={previewPrId} />
          )}

          {/* Ghost dir breadcrumb header */}
          {activeGhostDir && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={goBack}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-1.5 min-w-0">
                {/* Show real dir name as clickable ancestor */}
                <button
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors truncate"
                  onClick={() => setGhostDirStack([])}
                >
                  {realDirName}
                </button>
                {ghostDirStack.map((entry, i) => (
                  <span
                    key={entry.tempId}
                    className="flex items-center gap-1.5 min-w-0"
                  >
                    <span className="text-muted-foreground">/</span>
                    {i < ghostDirStack.length - 1 ? (
                      <button
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors truncate"
                        onClick={() =>
                          setGhostDirStack(ghostDirStack.slice(0, i + 1))
                        }
                      >
                        {entry.name}
                      </button>
                    ) : (
                      <span className="text-sm font-medium text-green-700 dark:text-green-400 truncate">
                        {entry.name}
                      </span>
                    )}
                  </span>
                ))}
                <Badge
                  variant="outline"
                  className="ml-1 text-[10px] text-green-600 border-green-300 shrink-0"
                >
                  Staged
                </Badge>
              </div>
            </div>
          )}
        </div>

        {!isAttachmentListing && (
          <div className="flex items-center flex-wrap gap-2 sm:justify-end">
            {/* Clipboard paste button */}
            {clipboard.length > 0 && (
              <Button
                key="paste-btn"
                size="sm"
                variant="outline"
                className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
                onClick={handlePaste}
              >
                <ClipboardPaste className="w-4 h-4" />
                Paste Here ({clipboard.length})
              </Button>
            )}
            {clipboard.length > 0 && (
              <Button
                key="cancel-paste-btn"
                size="sm"
                variant="ghost"
                className="gap-1 text-muted-foreground"
                onClick={clearClipboard}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            )}

            {/* Select mode toggle */}
            {!selectMode && allSelectableItems.length > 0 && (
              <Button
                key="select-btn"
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => setSelectMode(true)}
              >
                <CheckSquare className="w-4 h-4" />
                Select
              </Button>
            )}

            {!showActions && !selectMode ? (
              <Button
                key="add-item-btn"
                size="sm"
                className="gap-2"
                onClick={() => setShowActions(true)}
              >
                <Plus className="w-4 h-4" />
                Add Item
              </Button>
            ) : !selectMode ? (
              <>
                <Button
                  key="upload-btn"
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    setUploadOpen(true);
                    setShowActions(false);
                  }}
                >
                  <Upload className="w-4 h-4" />
                  <span className="hidden sm:inline">Upload Files</span>
                </Button>
                <Button
                  key="new-folder-btn"
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    setNewFolderOpen(true);
                    setShowActions(false);
                  }}
                >
                  <FolderPlus className="w-4 h-4" />
                  <span className="hidden sm:inline">New Folder</span>
                </Button>
                <Button
                  key="cancel-btn"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowActions(false)}
                >
                  Cancel
                </Button>
              </>
            ) : null}
          </div>
        )}
      </div>

      {isAttachmentListing && (
        <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-3 dark:border-violet-800/40 dark:bg-violet-950/20">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/50">
            <Paperclip className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-violet-900 dark:text-violet-200">
              Attachments
            </h2>
            <p className="text-xs text-muted-foreground">
              Supplementary files linked to this material
            </p>
          </div>
          <Button
            size="sm"
            className="gap-2 bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-700 dark:hover:bg-violet-600"
            onClick={() => {
              if (parentMaterial) {
                requestUpload({
                  directoryId: String(parentMaterial.directory_id ?? ""),
                  directoryName: String(parentMaterial.title ?? "Material"),
                  parentMaterialId: String(parentMaterial.id ?? ""),
                });
              }
            }}
          >
            <UploadCloud className="w-4 h-4" />
            Upload Attachment
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-violet-300 text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/50"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.history.back();
              }
            }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </div>
      )}

      {/* Batch select toolbar */}
      {selectMode && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 dark:bg-primary/10">
          <Checkbox
            checked={allSelected}
            onCheckedChange={() => {
              if (allSelected) deselectAll(allSelectableItems.map((i) => i.id));
              else selectAll(allSelectableItems);
            }}
            className="shrink-0"
          />
          <span className="text-sm font-medium flex-1">
            {selectedCount === 0 ? "Select items" : `${selectedCount} selected`}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:hover:bg-amber-950/30"
              disabled={selectedCount === 0}
              onClick={handleCut}
            >
              <Scissors className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Cut</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
              disabled={selectedCount === 0}
              onClick={handleBatchDelete}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Delete</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1"
              onClick={() => setSelectMode(false)}
            >
              <X className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Cancel</span>
            </Button>
          </div>
        </div>
      )}

      {/* Open PRs targeting this directory */}
      {!isAttachmentListing && !activeGhostDir && (
        <DirectoryOpenPRs directoryId={realDirId || "root"} />
      )}

      {/* Hint when inside an empty ghost dir */}
      {activeGhostDir && isEmpty && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-green-300 bg-green-50/30 dark:bg-green-950/10 py-12 px-4 text-center">
          <Folder className="h-10 w-10 text-green-400" />
          <div>
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              This folder is staged for creation
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload files or create sub-folders here. Everything will be
              submitted together when you create the pull request.
            </p>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="w-4 h-4" />
              Upload Files
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => setNewFolderOpen(true)}
            >
              <FolderPlus className="w-4 h-4" />
              New Folder
            </Button>
          </div>
        </div>
      )}

      {!activeGhostDir && isEmpty ? (
        isAttachmentListing ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-100/80 dark:bg-violet-950/30 mb-4">
              <Paperclip className="h-8 w-8 text-violet-400 opacity-60" />
            </div>
            <p className="text-lg font-medium text-muted-foreground">
              No attachments yet
            </p>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-xs">
              Attachments are supplementary files linked to this material. They
              can be added via contributions.
            </p>
          </div>
        ) : (
          <EmptyDirectory />
        )
      ) : (
        !isEmpty && (
          <div className="divide-y rounded-lg border">
            {/* Real directories */}
            {sortedDirs.map((dir, i) => {
              const id = String(dir.id);
              const op = allOps.find(
                (o) =>
                  ((o.op === "edit_directory" || o.op === "delete_directory") &&
                    o.directory_id === id) ||
                  (o.op === "move_item" &&
                    o.target_type === "directory" &&
                    o.target_id === id),
              );

              const staged = op
                ? op.op === "delete_directory"
                  ? "deleted"
                  : op.op === "edit_directory"
                    ? "edited"
                    : "moved"
                : null;

              let displayDir = dir;
              if (op?.op === "edit_directory") {
                displayDir = {
                  ...dir,
                  ...(op.name != null ? { name: op.name } : {}),
                  ...(op.type != null ? { type: op.type } : {}),
                  ...(op.description != null
                    ? { description: op.description }
                    : {}),
                  ...(op.tags != null ? { tags: op.tags } : {}),
                };
              }

              return (
                <DirectoryLineItem
                  key={id}
                  directory={displayDir}
                  staged={staged}
                  selectMode={selectMode}
                  selected={selected.has(id)}
                  onToggleSelect={() =>
                    toggleSelect({
                      id,
                      type: "directory",
                      name: String(dir.name ?? ""),
                      parentId: dirId || null,
                    })
                  }
                  previewPrId={previewPrId}
                  navIndex={i}
                  focused={focusedIndex === i}
                />
              );
            })}

            {/* Ghost directories (staged creates and moves) — clickable to enter */}
            {ghostDirs.map((op, i) => {
              const tempId =
                (op.op === "create_directory" ? op.temp_id : op.target_id) ||
                `ghost-${i}`;
              const isExternal = op.isExternal;
              const name =
                op.op === "create_directory" ? op.name : op.target_name;
              const isMove = op.op === "move_item";

              // Count items staged inside this ghost dir
              const childCount = allOps.filter((o) => {
                return (
                  (o.op === "create_material" && o.directory_id === tempId) ||
                  (o.op === "create_directory" && o.parent_id === tempId)
                );
              }).length;

              const themeColor = isMove
                ? "amber"
                : isExternal
                  ? "blue"
                  : "green";
              const borderStyle = isExternal ? "border-solid" : "border-dashed";

              const ghostDirNavIndex = sortedDirs.length + i;
              const ghostDirFocused = focusedIndex === ghostDirNavIndex;
              return (
                <div
                  key={`ghost-dir-${tempId}`}
                  data-nav-index={ghostDirNavIndex}
                  className={`flex items-center gap-3 px-4 py-3 ${borderStyle} border-l-2 border-l-${themeColor}-400 bg-${themeColor}-50/50 dark:bg-${themeColor}-950/20 cursor-pointer opacity-80 hover:opacity-100 hover:bg-${themeColor}-50 dark:hover:bg-${themeColor}-950/30 transition-all${ghostDirFocused ? " ring-2 ring-inset ring-primary/40" : ""}`}
                  onClick={() => enterGhostDir(tempId, name || "Unnamed")}
                >
                  <Folder
                    className={`h-5 w-5 shrink-0 text-${themeColor}-500`}
                  />
                  <div className="min-w-0 flex-1">
                    <span
                      className={`block truncate font-medium text-${themeColor}-700 dark:text-${themeColor}-400`}
                    >
                      {name}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge
                        variant="outline"
                        className={`text-[10px] text-${themeColor}-600 border-${themeColor}-300`}
                      >
                        {isMove
                          ? "Moved here"
                          : isExternal
                            ? "Contribution"
                            : "Draft"}
                      </Badge>
                      {childCount > 0 && (
                        <span className={`text-[10px] text-${themeColor}-600`}>
                          {childCount} item{childCount !== 1 ? "s" : ""} inside
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`text-${themeColor}-400 text-sm`}>→</span>
                </div>
              );
            })}

            {/* Real materials */}
            {sortedMats.map((mat, i) => {
              const id = String(mat.id);
              const op = allOps.find(
                (o) =>
                  ((o.op === "edit_material" || o.op === "delete_material") &&
                    o.material_id === id) ||
                  (o.op === "move_item" &&
                    o.target_type === "material" &&
                    o.target_id === id),
              );

              const staged = op
                ? op.op === "delete_material"
                  ? "deleted"
                  : op.op === "edit_material"
                    ? "edited"
                    : "moved"
                : null;

              const previewOpIndex =
                op?.isExternal && op.op === "edit_material"
                  ? op._previewIdx
                  : undefined;

              let displayMat = mat;
              if (op?.op === "edit_material") {
                displayMat = {
                  ...mat,
                  ...(op.title != null ? { title: op.title } : {}),
                  ...(op.type != null ? { type: op.type } : {}),
                  ...(op.description != null
                    ? { description: op.description }
                    : {}),
                  ...(op.tags != null ? { tags: op.tags } : {}),
                };
              }

              const matNavIndex = sortedDirs.length + ghostDirs.length + i;
              return (
                <MaterialLineItem
                  key={id}
                  material={displayMat}
                  staged={staged}
                  previewOpIndex={previewOpIndex}
                  selectMode={selectMode}
                  selected={selected.has(id)}
                  onToggleSelect={() =>
                    toggleSelect({
                      id,
                      type: "material",
                      name: String(mat.title ?? ""),
                      parentId: dirId || null,
                      material_type: String(mat.type ?? "other"),
                    })
                  }
                  previewPrId={previewPrId}
                  navIndex={matNavIndex}
                  focused={focusedIndex === matNavIndex}
                />
              );
            })}

            {/* Ghost materials (staged creates and moves) */}
            {ghostMaterials.map((op, i) => {
              const isExternal = op.isExternal;
              const isMove = op.op === "move_item";
              const title =
                op.op === "create_material" ? op.title : op.target_title;
              const tempId =
                op.op === "create_material" ? op.temp_id : op.target_id;

              const attachCount =
                op.op === "create_material" && op.temp_id
                  ? allOps.filter(
                      (
                        o,
                      ): o is CreateMaterialOp & {
                        isExternal: boolean;
                        _previewIdx: number | undefined;
                      } =>
                        o.op === "create_material" &&
                        o.parent_material_id === op.temp_id,
                    ).length
                  : 0;

              const themeColor = isMove
                ? "amber"
                : isExternal
                  ? "blue"
                  : "green";
              const borderStyle = isExternal ? "border-solid" : "border-dashed";

              const ghostMatNavIndex =
                sortedDirs.length + ghostDirs.length + sortedMats.length + i;
              const ghostMatFocused = focusedIndex === ghostMatNavIndex;
              return (
                <div
                  key={`ghost-mat-${tempId ?? i}`}
                  data-nav-index={ghostMatNavIndex}
                  className={`flex items-center gap-3 px-4 py-3 ${borderStyle} border-l-2 border-l-${themeColor}-400 bg-${themeColor}-50/50 dark:bg-${themeColor}-950/20 cursor-pointer opacity-75 hover:opacity-100 transition-opacity${ghostMatFocused ? " ring-2 ring-inset ring-primary/40" : ""}`}
                  onClick={() => {
                    if (isExternal) {
                      if (previewPrId && op._previewIdx !== undefined) {
                        router.push(
                          `/pull-requests/${previewPrId}/preview/${op._previewIdx}`,
                        );
                      }
                    } else {
                      setReviewOpen(true);
                    }
                  }}
                >
                  <FileText
                    className={`h-5 w-5 shrink-0 text-${themeColor}-500`}
                  />
                  <div className="min-w-0 flex-1">
                    <span
                      className={`block truncate font-medium text-${themeColor}-700 dark:text-${themeColor}-400`}
                    >
                      {title}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge
                        variant="outline"
                        className={`text-[10px] text-${themeColor}-600 border-${themeColor}-300`}
                      >
                        {isMove
                          ? "Moved here"
                          : isExternal
                            ? "Contribution"
                            : "Draft"}
                      </Badge>
                      {(op.op === "create_material"
                        ? op.type
                        : op.target_material_type) && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 h-4 capitalize"
                        >
                          {op.op === "create_material"
                            ? op.type
                            : op.target_material_type}
                        </Badge>
                      )}
                      {op.op === "create_material" && op.file_name && (
                        <span className="text-[10px] text-muted-foreground truncate">
                          {op.file_name}
                        </span>
                      )}
                      {attachCount > 0 && (
                        <span
                          className={`inline-flex items-center gap-0.5 text-[10px] text-violet-600 dark:text-violet-400`}
                        >
                          <Paperclip className="h-3 w-3" />
                          {attachCount}
                        </span>
                      )}
                    </div>
                  </div>
                  {op.op === "create_material" && op.temp_id && !isExternal && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 gap-1 text-violet-600 hover:text-violet-700 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-violet-950/40"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestUpload({
                          directoryId: dirId ?? "",
                          directoryName: op.title,
                          parentMaterialId: op.temp_id!,
                        });
                      }}
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      {isMobile ? "" : "Joindre"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Upload Drawer — targets effective dirId (real UUID or temp_id) */}
      <UploadDrawer
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        directoryId={dirId}
        directoryName={dirName}
      />

      {/* New Folder Dialog — targets effective dirId */}
      <NewFolderDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        parentId={dirId || null}
        parentName={dirName}
      />
      {/* Batch Delete Dialog */}
      <Dialog
        open={batchDeleteOps !== null}
        onOpenChange={(open) => !open && setBatchDeleteOps(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete {batchDeleteOps?.length} item
              {batchDeleteOps?.length !== 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              Do you want to delete these items? You can submit the deletion
              immediately or add it to your draft.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button
              variant="ghost"
              onClick={() => setBatchDeleteOps(null)}
              disabled={submittingBatch}
              className="sm:mr-auto"
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={submittingBatch}
              onClick={() => {
                if (batchDeleteOps) {
                  addOperations(batchDeleteOps);
                  toast.success(
                    `${batchDeleteOps.length} item${batchDeleteOps.length !== 1 ? "s" : ""} added to draft`,
                  );
                  setBatchDeleteOps(null);
                  setSelectMode(false);
                }
              }}
              className="gap-2 border-dashed border-destructive/50 text-destructive hover:bg-destructive/10"
            >
              <Plus className="h-4 w-4" /> Draft
            </Button>
            <Button
              variant="destructive"
              disabled={submittingBatch}
              onClick={async () => {
                if (batchDeleteOps) {
                  setSubmittingBatch(true);
                  const result = await submitDirectOperations(batchDeleteOps);
                  setSubmittingBatch(false);
                  setBatchDeleteOps(null);
                  setSelectMode(false);
                  if (result?.status === "approved") {
                    triggerBrowseRefresh();
                  }
                }
              }}
              className="gap-2"
            >
              {submittingBatch ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}{" "}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Paste/Move Dialog */}
      <Dialog
        open={batchPasteOps !== null}
        onOpenChange={(open) => !open && setBatchPasteOps(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <ClipboardPaste className="h-5 w-5" />
              Move {batchPasteOps?.length} item
              {batchPasteOps?.length !== 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              Do you want to move them here? You can perform the action
              immediately or add it to your draft.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button
              variant="ghost"
              onClick={() => setBatchPasteOps(null)}
              disabled={submittingBatch}
              className="sm:mr-auto"
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={submittingBatch}
              onClick={() => {
                if (batchPasteOps) {
                  addOperations(batchPasteOps);
                  toast.success(
                    `${batchPasteOps.length} item${batchPasteOps.length !== 1 ? "s" : ""} added to draft`,
                  );
                  setBatchPasteOps(null);
                  clearClipboard();
                }
              }}
              className="gap-2 border-dashed border-primary/50 text-primary hover:bg-primary/5"
            >
              <Plus className="h-4 w-4" /> Draft
            </Button>
            {!dirId?.startsWith("$") && (
              <Button
                disabled={submittingBatch}
                onClick={async () => {
                  if (batchPasteOps) {
                    setSubmittingBatch(true);
                    const result = await submitDirectOperations(batchPasteOps);
                    setSubmittingBatch(false);
                    setBatchPasteOps(null);
                    clearClipboard();
                    if (result?.status === "approved") {
                      triggerBrowseRefresh();
                    }
                  }
                }}
                className="gap-2"
              >
                {submittingBatch ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}{" "}
                Direct move
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

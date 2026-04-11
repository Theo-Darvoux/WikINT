"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Download,
  Share2,
  Paperclip,
  UploadCloud,
  Loader2,
  Printer,
  Info,
  MessageSquare,
  Highlighter,
  GitPullRequest,
} from "lucide-react";
import { FlagButton } from "@/components/flags/flag-button";
import { useDropZoneStore } from "@/components/pr/global-drop-zone";
import { useDownload } from "@/hooks/use-download";
import { usePrint } from "@/hooks/use-print";
import { useUIStore } from "@/lib/stores";
import { toast } from "sonner";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

// ─── Action cell ──────────────────────────────────────────────────────────────

interface ActionCellProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  href?: string;
  badge?: number;
  tint?: "default" | "violet" | "destructive";
}

function ActionCell({
  icon,
  label,
  onClick,
  disabled = false,
  href,
  badge,
  tint = "default",
}: ActionCellProps) {
  const tileClass = cn(
    "relative flex h-16 w-16 items-center justify-center rounded-2xl transition-transform active:scale-90",
    {
      "bg-secondary": tint === "default",
      "bg-violet-500/15 dark:bg-violet-500/20": tint === "violet",
      "bg-destructive/10": tint === "destructive",
    },
  );

  const tile = (
    <span className={tileClass}>
      {icon}
      {badge != null && badge > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </span>
  );

  const labelEl = (
    <span className="text-[11.5px] font-medium text-muted-foreground text-center truncate w-full px-1">
      {label}
    </span>
  );

  const wrap = "flex flex-col items-center gap-2 overflow-hidden";

  if (href) {
    return (
      <DrawerClose asChild>
        <Link href={href} className={wrap}>
          {tile}
          {labelEl}
        </Link>
      </DrawerClose>
    );
  }

  return (
    <button className={wrap} onClick={onClick} disabled={disabled}>
      {tile}
      {labelEl}
    </button>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ViewerFabProps {
  material: Record<string, unknown>;
  materialId: string;
  materialTitle?: string;
  directoryId?: string;
  attachmentCount?: number;
  isAttachment?: boolean;
  viewerType?: string;
  mimeType?: string;
  fileName?: string;
  /** Controlled open state — owned by the parent (MaterialViewer). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ViewerFab({
  material,
  materialId,
  materialTitle,
  directoryId,
  attachmentCount = 0,
  isAttachment = false,
  viewerType = "",
  mimeType = "",
  fileName = "",
  open,
  onOpenChange,
}: ViewerFabProps) {
  const pathname = usePathname();
  const requestUpload = useDropZoneStore((s) => s.requestUpload);
  const { openSidebar } = useUIStore();
  const { downloadMaterial, isDownloading } = useDownload();
  const { print, isPrinting, canPrint } = usePrint({
    viewerType,
    materialId,
    fileName,
    mimeType,
  });

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      toast.success("Link copied to clipboard");
    });
  };

  const handleUpload = () => {
    requestUpload({
      directoryId: directoryId ?? "",
      directoryName: materialTitle ?? "Material",
      parentMaterialId: materialId,
    });
  };

  const close = () => onOpenChange(false);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className={cn(
          "rounded-t-3xl border-t border-border/50 px-5 pb-10 pt-0",
        )}
      >
        {/* Visually hidden title satisfies Radix's a11y requirement */}
        <DrawerTitle className="sr-only">Document actions</DrawerTitle>

        {/* The Drawer component provides its own drag handle viavaul's styling */}

        {/*
          3-column grid.
          Inline style bypasses any flex/grid context SheetContent may impose.
        */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "1.25rem 0.5rem",
          }}
        >
          {/* ── Download ── */}
          <ActionCell
            icon={
              isDownloading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Download className="h-5 w-5" />
              )
            }
            label="Download"
            disabled={isDownloading}
            onClick={() => {
              close();
              downloadMaterial(materialId);
            }}
          />

          {/* ── Share ── */}
          <ActionCell
            icon={<Share2 className="h-5 w-5" />}
            label="Share"
            onClick={() => {
              close();
              handleShare();
            }}
          />

          {/* ── Print ── */}
          {canPrint && (
            <ActionCell
              icon={
                isPrinting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Printer className="h-5 w-5" />
                )
              }
              label="Print"
              disabled={isPrinting}
              onClick={() => {
                close();
                print();
              }}
            />
          )}

          {/* ── Details ── */}
          <ActionCell
            icon={<Info className="h-5 w-5" />}
            label="Details"
            onClick={() => {
              close();
              openSidebar("details", {
                type: "material",
                id: materialId,
                data: { ...material, __viewerType: viewerType },
              });
            }}
          />

          {/* ── Chat ── */}
          <ActionCell
            icon={<MessageSquare className="h-5 w-5" />}
            label="Chat"
            onClick={() => {
              close();
              openSidebar("chat", {
                type: "material",
                id: materialId,
                data: material,
              });
            }}
          />

          {/* ── View attachments ── */}
          {!isAttachment && (
            <ActionCell
              icon={<Paperclip className="h-5 w-5 text-violet-500" />}
              label="Attachments"
              tint="violet"
              href={`${pathname}/attachments`}
              badge={attachmentCount}
            />
          )}

          {/* ── Annotations ── */}
          <ActionCell
            icon={<Highlighter className="h-5 w-5" />}
            label="Annotations"
            onClick={() => {
              close();
              openSidebar("annotations", {
                type: "material",
                id: materialId,
                data: material,
              });
            }}
          />

          {/* ── Edits ── */}
          <ActionCell
            icon={<GitPullRequest className="h-5 w-5" />}
            label="Edits"
            onClick={() => {
              close();
              openSidebar("edits", {
                type: "material",
                id: materialId,
                data: material,
              });
            }}
          />

          {/* ── Upload attachment ── */}
          {!isAttachment && (
            <ActionCell
              icon={<UploadCloud className="h-5 w-5 text-violet-500" />}
              label="Upload"
              tint="violet"
              onClick={() => {
                close();
                handleUpload();
              }}
            />
          )}

          {/* ── Report ── */}
          <div className="flex flex-col items-center gap-2 overflow-hidden">
            <FlagButton
              targetType="material"
              targetId={materialId}
              variant="ghost"
              size="icon"
              className="h-16 w-16 rounded-2xl bg-destructive/10 text-destructive hover:bg-destructive/20 active:scale-90 transition-transform"
              iconClassName="h-5 w-5"
              hideText
            />
            <span className="text-[11.5px] font-medium text-muted-foreground text-center truncate w-full px-1">
              Report
            </span>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

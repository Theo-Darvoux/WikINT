"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Folder, Info, ChevronRight, ThumbsUp } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useIsMobile } from "@/hooks/use-media-query";
import { useUIStore } from "@/lib/stores";

interface DirectoryLineItemProps {
    directory: Record<string, unknown>;
    staged?: "edited" | "deleted" | "moved" | null;
    selectMode?: boolean;
    selected?: boolean;
    onToggleSelect?: () => void;
    /** When set, appended as ?preview_pr= to preserve preview mode across navigation */
    previewPrId?: string;
    navIndex?: number;
    focused?: boolean;
}

export function DirectoryLineItem({ directory, staged, selectMode, selected, onToggleSelect, previewPrId, navIndex, focused }: DirectoryLineItemProps) {
    const isMobile = useIsMobile();
    const { openSidebar } = useUIStore();
    const pathname = usePathname();
    const router = useRouter();

    const name = String(directory.name ?? "");
    const slug = String(directory.slug ?? "");
    const id = String(directory.id ?? "");
    const childDirCount = Number(directory.child_directory_count ?? 0);
    const childMatCount = Number(directory.child_material_count ?? 0);
    const totalCount = childDirCount + childMatCount;
    const likeCount = Number(directory.like_count ?? 0);
    const isLiked = Boolean(directory.is_liked);

    const buildPath = () => {
        const base = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
        const dirPath = `${base}/${slug}`;
        return previewPrId ? `${dirPath}?preview_pr=${previewPrId}` : dirPath;
    };

    const handleDetails = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        openSidebar("details", { type: "directory", id, data: directory });
    };

    const handleCardClick = () => {
        if (selectMode && onToggleSelect) {
            onToggleSelect();
            return;
        }
        router.push(buildPath());
    };

    const stagedBorder = staged === "deleted"
        ? "border-l-2 border-l-red-400 bg-red-50/50 dark:bg-red-950/20"
        : staged === "edited"
          ? "border-l-2 border-l-green-400 bg-green-50/50 dark:bg-green-950/20"
          : staged === "moved"
            ? "border-l-2 border-l-amber-400 bg-amber-50/50 dark:bg-amber-950/20"
            : "";

    return (
        <div
            onClick={handleCardClick}
            data-nav-index={navIndex}
            className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 cursor-pointer ${stagedBorder} ${selectMode && selected ? "bg-primary/5 dark:bg-primary/10" : ""} ${focused ? "bg-muted ring-2 ring-inset ring-primary/40" : ""}`}
        >
            {selectMode && (
                <Checkbox
                    checked={!!selected}
                    onCheckedChange={() => onToggleSelect?.()}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0"
                />
            )}
            <Folder className={`h-5 w-5 shrink-0 ${staged === "deleted" ? "text-red-500" : staged === "moved" ? "text-amber-500" : "text-blue-500"}`} />

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className={`block truncate font-medium ${staged === "deleted" ? "line-through text-red-700 dark:text-red-400" : staged === "moved" ? "text-amber-700 dark:text-amber-400" : ""}`}>{name}</span>
                    {staged && (
                        <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                            staged === "deleted"
                                ? "text-red-600 border-red-300"
                                : staged === "moved"
                                  ? "text-amber-600 border-amber-300"
                                  : "text-green-600 border-green-300"
                        }`}>
                            {staged === "deleted" ? "Deleting" : staged === "moved" ? "Moving" : "Edited"}
                        </span>
                    )}
                </div>
                {!isMobile && (
                    <span className="text-sm text-muted-foreground">
                        {totalCount} {totalCount === 1 ? "item" : "items"}
                    </span>
                )}
            </div>

            {!isMobile && (
                <div className="flex flex-col items-end justify-center px-2 text-[11px] leading-tight text-muted-foreground opacity-80">
                    <span className="flex items-center gap-1" title="Likes">
                        {likeCount}
                        <ThumbsUp className={`h-3 w-3 ${isLiked ? "fill-primary text-primary" : ""}`} />
                    </span>
                </div>
            )}

            <div className="flex shrink-0 items-center gap-1">
                {isMobile ? (
                    <>
                        <span className="text-xs text-muted-foreground">{totalCount}</span>
                        <Link href={buildPath()} onClick={(e) => e.stopPropagation()}>
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </Link>
                    </>
                ) : (
                    <>
                        <button
                            onClick={handleDetails}
                            className="rounded-md p-2 hover:bg-muted"
                            title="Details"
                        >
                            <Info className="h-4 w-4 text-muted-foreground" />
                        </button>
                        <Link href={buildPath()} className="rounded-md p-2 hover:bg-muted" title="Open" onClick={(e) => e.stopPropagation()}>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </Link>
                    </>
                )}
            </div>
        </div>
    );
}

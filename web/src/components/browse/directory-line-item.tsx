"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Folder, Info, ChevronRight, ThumbsUp, MessageSquare } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ItemActionsMenu, ItemActionsDropdownTrigger } from "./item-actions-menu";
import { useIsMobile } from "@/hooks/use-media-query";
import { useUIStore } from "@/lib/stores";

interface DirectoryLineItemProps {
    directory: Record<string, unknown>;
    staged?: "edited" | "deleted" | "moved" | "created" | null;
    isExternal?: boolean;
    selectMode?: boolean;
    selected?: boolean;
    onToggleSelect?: (e?: React.MouseEvent) => void;
    /** When set, appended as ?preview_pr= to preserve preview mode across navigation */
    previewPrId?: string;
    navIndex?: number;
    focused?: boolean;
    /** Special override for clicking on ghost directories (creations) */
    onNavigate?: () => void;
}

export function DirectoryLineItem({
    directory,
    staged,
    isExternal,
    selectMode,
    selected,
    onToggleSelect,
    previewPrId,
    navIndex,
    focused,
    onNavigate,
}: DirectoryLineItemProps) {
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

    const handleChat = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        openSidebar("chat", { type: "directory", id, data: directory });
    };

    const handleCardClick = (e: React.MouseEvent) => {
        if (selectMode && onToggleSelect) {
            onToggleSelect(e);
            return;
        }
        if (onNavigate) {
            onNavigate();
        } else {
            router.push(buildPath());
        }
    };

    const themeColor =
        staged === "deleted"
            ? "red"
            : staged === "moved"
                ? "amber"
                : isExternal
                    ? "blue"
                    : "green";

    const borderStyle = isExternal ? "border-solid" : "border-dashed";

    const stagedBorder = staged
        ? `border-l-2 ${borderStyle} border-l-${themeColor}-400 bg-${themeColor}-50/50 dark:bg-${themeColor}-950/20`
        : "";

    const iconColor =
        staged === "deleted"
            ? "text-red-500"
            : staged === "moved"
                ? "text-amber-500"
                : staged === "created"
                    ? `text-${themeColor}-500`
                    : "text-blue-500";

    const textColor =
        staged === "deleted"
            ? "line-through text-red-700 dark:text-red-400"
            : staged === "moved"
                ? "text-amber-700 dark:text-amber-400"
                : (staged === "created" || staged === "edited")
                    ? `text-${themeColor}-700 dark:text-${themeColor}-400`
                    : "";

    return (
        <ItemActionsMenu item={{ id, type: "directory", data: directory, staged, isExternal }}>
            <div
                onClick={handleCardClick}
                data-nav-index={navIndex}
                className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 cursor-pointer ${stagedBorder} ${selectMode && selected ? "bg-primary/5 dark:bg-primary/10" : ""} ${focused ? "bg-muted ring-2 ring-inset ring-primary/40" : ""}`}
            >
                {selectMode && (
                    <Checkbox
                        checked={!!selected}
                        onCheckedChange={() => {}} // Handled by onClick below
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleSelect?.(e);
                        }}
                        className="shrink-0"
                    />
                )}
                <Folder className={`h-6 w-6 shrink-0 ${iconColor}`} />

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className={`block truncate font-medium ${textColor}`}>
                            {name}
                        </span>
                        {staged && (
                            <span
                                className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                                    staged === "deleted"
                                        ? "text-red-600 border-red-300"
                                        : staged === "moved"
                                            ? "text-amber-600 border-amber-300"
                                            : isExternal
                                                ? "text-blue-600 border-blue-300"
                                                : "text-green-600 border-green-300"
                                }`}
                            >
                                {staged === "deleted"
                                    ? "Deleting"
                                    : staged === "moved"
                                        ? "Moving"
                                        : staged === "created"
                                            ? isExternal
                                                ? "Contribution"
                                                : "Draft"
                                            : "Edited"}
                            </span>
                        )}
                    </div>
                    <span className={`text-sm ${staged ? `text-${themeColor}-600/70` : "text-muted-foreground"}`}>
                        {totalCount} {totalCount === 1 ? "item" : "items"}
                    </span>
                </div>

                {!isMobile && likeCount > 0 && (
                    <div className="flex flex-col items-end justify-center px-2 text-[11px] leading-tight text-muted-foreground opacity-80">
                        <span className="flex items-center gap-1" title="Likes">
                            {likeCount}
                            <ThumbsUp className={`h-3 w-3 ${isLiked ? "fill-primary text-primary" : ""}`} />
                        </span>
                    </div>
                )}
                    <div className="flex shrink-0 items-center gap-1">
                        {!staged ? (
                            <>
                                <button
                                    onClick={handleChat}
                                    className="rounded-md p-2 hover:bg-muted active:scale-95 transition-transform"
                                    title="Chat"
                                    aria-label={`Chat about ${name}`}
                                >
                                    <MessageSquare className={`${isMobile ? "h-5 w-5" : "h-4 w-4"} text-muted-foreground`} />
                                </button>
                            </>
                        ) : null}
                        <button
                            onClick={handleDetails}
                            className="rounded-md p-2 hover:bg-muted active:scale-95 transition-transform"
                            title="Details"
                            aria-label={`View details for ${name}`}
                        >
                            <Info className={`${isMobile ? "h-5 w-5" : "h-4 w-4"} text-muted-foreground`} />
                        </button>
                        <ItemActionsDropdownTrigger />
                    <Link
                        href={buildPath()}
                        className="rounded-md p-2 hover:bg-muted active:scale-95 transition-transform"
                        title="Open"
                        onClick={(e) => {
                            if (onNavigate) {
                                e.preventDefault();
                                e.stopPropagation();
                                onNavigate();
                            } else {
                                e.stopPropagation();
                            }
                        }}
                        aria-label={`Open ${name}`}
                    >
                        <ChevronRight className={`${isMobile ? "h-5 w-5" : "h-4 w-4"} text-muted-foreground`} />
                    </Link>
                </div>
            </div>
        </ItemActionsMenu>
    );
}

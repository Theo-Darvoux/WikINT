"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Folder, MessageSquare, Info, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useIsMobile } from "@/hooks/use-media-query";
import { useUIStore } from "@/lib/stores";

interface DirectoryLineItemProps {
    directory: Record<string, unknown>;
    staged?: "edited" | "deleted" | null;
    selectMode?: boolean;
    selected?: boolean;
    onToggleSelect?: () => void;
}

export function DirectoryLineItem({ directory, staged, selectMode, selected, onToggleSelect }: DirectoryLineItemProps) {
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

    const buildPath = () => {
        const base = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
        return `${base}/${slug}`;
    };

    const handleChat = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        openSidebar("chat", { type: "directory", id, data: directory });
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
          : "";

    return (
        <div
            onClick={handleCardClick}
            className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 cursor-pointer ${stagedBorder} ${selectMode && selected ? "bg-primary/5 dark:bg-primary/10" : ""}`}
        >
            {selectMode && (
                <Checkbox
                    checked={!!selected}
                    onCheckedChange={() => onToggleSelect?.()}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0"
                />
            )}
            <Folder className={`h-5 w-5 shrink-0 ${staged === "deleted" ? "text-red-500" : "text-blue-500"}`} />

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className={`block truncate font-medium ${staged === "deleted" ? "line-through text-red-700 dark:text-red-400" : ""}`}>{name}</span>
                    {staged && (
                        <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                            staged === "deleted"
                                ? "text-red-600 border-red-300"
                                : "text-green-600 border-green-300"
                        }`}>
                            {staged === "deleted" ? "Deleting" : "Edited"}
                        </span>
                    )}
                </div>
                {!isMobile && (
                    <span className="text-sm text-muted-foreground">
                        {totalCount} {totalCount === 1 ? "item" : "items"}
                    </span>
                )}
            </div>

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
                            onClick={handleChat}
                            className="rounded-md p-2 hover:bg-muted"
                            title="Chat"
                        >
                            <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        </button>
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

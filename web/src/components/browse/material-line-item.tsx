"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    FileText, MessageSquare, Info, Eye, ThumbsUp,
    FileImage, FileVideo, FileAudio, FileArchive, FileSpreadsheet, FileCode, File, Lightbulb, ClipboardCheck, Video,
    Paperclip,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useIsMobile } from "@/hooks/use-media-query";
import { useUIStore } from "@/lib/stores";
import { EXT_BADGE_COLORS, getFileBadgeLabel, getFileExtension } from "@/lib/file-utils";

const TYPE_COLORS: Record<string, string> = {
    polycopie: "bg-blue-100 text-blue-800",
    annal: "bg-orange-100 text-orange-800",
    cheatsheet: "bg-green-100 text-green-800",
    tip: "bg-yellow-100 text-yellow-800",
    review: "bg-purple-100 text-purple-800",
    discussion: "bg-pink-100 text-pink-800",
    video: "bg-red-100 text-red-800",
    other: "bg-gray-100 text-gray-800",
};

const TYPE_LABELS: Record<string, string> = {
    polycopie: "Polycopié",
    annal: "Annale",
    cheatsheet: "Cheatsheet",
    tip: "Tip",
    review: "Review",
    discussion: "Discussion",
    video: "Video",
    other: "Other",
};

const TYPE_ICONS: Record<string, React.ElementType> = {
    polycopie: FileText,
    annal: FileText,
    cheatsheet: FileText,
    tip: Lightbulb,
    review: ClipboardCheck,
    discussion: MessageSquare,
    video: Video,
    other: File,
    document: FileText,
};

const EXT_ICONS: Record<string, React.ElementType> = {
    pdf: FileText,
    doc: FileText,
    docx: FileText,
    txt: FileText,
    xls: FileSpreadsheet,
    xlsx: FileSpreadsheet,
    csv: FileSpreadsheet,
    png: FileImage,
    jpg: FileImage,
    jpeg: FileImage,
    gif: FileImage,
    webp: FileImage,
    svg: FileImage,
    mp4: FileVideo,
    avi: FileVideo,
    mkv: FileVideo,
    webm: FileVideo,
    mp3: FileAudio,
    wav: FileAudio,
    ogg: FileAudio,
    zip: FileArchive,
    rar: FileArchive,
    "7z": FileArchive,
    tar: FileArchive,
    gz: FileArchive,
    js: FileCode,
    ts: FileCode,
    py: FileCode,
    html: FileCode,
    css: FileCode,
    json: FileCode,
};


interface MaterialLineItemProps {
    material: Record<string, unknown>;
    staged?: "edited" | "deleted" | "moved" | null;
    selectMode?: boolean;
    selected?: boolean;
    onToggleSelect?: () => void;
    /** When set, appended as ?preview_pr= to preserve preview mode across navigation */
    previewPrId?: string;
    navIndex?: number;
    focused?: boolean;
    /** The index of the operation in the PR payload, if this is an external preview edit */
    previewOpIndex?: number;
}

export function MaterialLineItem({ material, staged, selectMode, selected, onToggleSelect, previewPrId, navIndex, focused, previewOpIndex }: MaterialLineItemProps) {
    const isMobile = useIsMobile();
    const { openSidebar } = useUIStore();
    const pathname = usePathname();
    const router = useRouter();

    const title = String(material.title ?? "");
    const slug = String(material.slug ?? "");
    const id = String(material.id ?? "");
    const type = String(material.type ?? "other");
    const attachmentCount = Number(material.attachment_count ?? 0);
    const totalViews = Number(material.total_views ?? 0);
    const viewsToday = Number(material.views_today ?? 0);
    const likeCount = Number(material.like_count ?? 0);
    const isLiked = Boolean(material.is_liked);

    // Extract file name from current version info if available
    let fileName = "";
    let mimeType = "";
    if (material.current_version_info && typeof material.current_version_info === "object") {
        const vi = material.current_version_info as Record<string, unknown>;
        fileName = vi.file_name ? String(vi.file_name) : "";
        mimeType = vi.file_mime_type ? String(vi.file_mime_type) : "";
    }

    const buildPath = () => {
        // If this is an external edit preview, link directly to the PR preview page
        if (staged === "edited" && previewPrId && previewOpIndex !== undefined) {
            return `/pull-requests/${previewPrId}/preview/${previewOpIndex}`;
        }
        const base = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
        const matPath = `${base}/${slug}`;
        return previewPrId ? `${matPath}?preview_pr=${previewPrId}` : matPath;
    };

    let badgeColor = TYPE_COLORS[type] ?? TYPE_COLORS.other;

    let badgeLabel = TYPE_LABELS[type] ?? type;
    let Icon = TYPE_ICONS[type] ?? File;

    if (type === "document") {
        const fallbackLabel = getFileBadgeLabel(fileName, mimeType);
        if (fallbackLabel && fallbackLabel !== "FILE") {
            badgeLabel = fallbackLabel;
        }

        const ext = getFileExtension(fileName);
        if (ext && EXT_ICONS[ext]) {
            Icon = EXT_ICONS[ext];
        } else if (mimeType && mimeType.includes("pdf")) {
            Icon = FileText;
        }

        // Try to get a meaningful color
        let newColor = badgeColor;
        if (ext && EXT_BADGE_COLORS[ext]) {
            newColor = EXT_BADGE_COLORS[ext];
        } else if (mimeType) {
            if (mimeType === "application/pdf") newColor = EXT_BADGE_COLORS["pdf"];
            else if (mimeType.startsWith("image/")) newColor = EXT_BADGE_COLORS["jpg"];
            else if (mimeType.startsWith("video/")) newColor = EXT_BADGE_COLORS["mp4"];
            else if (mimeType.startsWith("audio/")) newColor = EXT_BADGE_COLORS["mp3"];
            else if (mimeType.includes("document") || mimeType.includes("msword")) newColor = EXT_BADGE_COLORS["doc"];
            else if (mimeType.includes("sheet") || mimeType.includes("excel")) newColor = EXT_BADGE_COLORS["xls"];
        }
        if (newColor && newColor !== badgeColor) {
            badgeColor = newColor;
        }
    }

    const iconColorClass = badgeColor.split(" ").find(c => c.startsWith("text-")) || "text-muted-foreground";

    const handleDetails = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        openSidebar("details", { type: "material", id, data: material });
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
            <Icon className={`h-5 w-5 shrink-0 ${staged === "deleted" ? "text-red-500" : staged === "moved" ? "text-amber-500" : iconColorClass}`} />

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className={`block truncate font-medium ${staged === "deleted" ? "line-through text-red-700 dark:text-red-400" : staged === "moved" ? "text-amber-700 dark:text-amber-400" : ""}`}>{title}</span>
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
                <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-xs font-medium ${badgeColor}`}>
                    {badgeLabel}
                </span>
                {attachmentCount > 0 && (
                    <span className="mt-0.5 ml-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                        <Paperclip className="h-3 w-3" />
                        {attachmentCount}
                    </span>
                )}
            </div>

            {!isMobile && (
                <div className="flex flex-col items-end justify-center px-2 text-[11px] leading-tight text-muted-foreground opacity-80">
                    <span className="flex items-center gap-1" title="Likes">
                        {likeCount}
                        <ThumbsUp className={`h-3 w-3 ${isLiked ? "fill-primary text-primary" : ""}`} />
                    </span>
                    <span className="flex items-center gap-1" title="Total views">
                        {totalViews}
                        <Eye className="h-3 w-3" />
                    </span>
                </div>
            )}

            <div className="flex shrink-0 items-center gap-1">
                <button
                    onClick={handleDetails}
                    className="rounded-md p-2 hover:bg-muted active:scale-95 transition-transform"
                    title="Details"
                    aria-label={`View details for ${title}`}
                >
                    <Info className={`${isMobile ? "h-5 w-5" : "h-4 w-4"} text-muted-foreground`} />
                </button>
                <Link
                    href={buildPath()}
                    className="rounded-md p-2 hover:bg-muted active:scale-95 transition-transform"
                    title={isMobile ? "View" : "Preview"}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`${isMobile ? "View" : "Preview"} ${title}`}
                >
                    <Eye className={`${isMobile ? "h-5 w-5" : "h-4 w-4"} text-muted-foreground`} />
                </Link>
            </div>
        </div>
    );
}

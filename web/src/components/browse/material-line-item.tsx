"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    FileText, MessageSquare, Info, Eye,
    FileImage, FileVideo, FileAudio, FileArchive, FileSpreadsheet, FileCode, File, Lightbulb, ClipboardCheck, Video,
    Paperclip,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useIsMobile } from "@/hooks/use-media-query";
import { useUIStore } from "@/lib/stores";

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

const EXT_COLORS: Record<string, string> = {
    pdf: "bg-red-100 text-red-800",
    doc: "bg-blue-100 text-blue-800",
    docx: "bg-blue-100 text-blue-800",
    txt: "bg-slate-100 text-slate-800",
    xls: "bg-emerald-100 text-emerald-800",
    xlsx: "bg-emerald-100 text-emerald-800",
    csv: "bg-emerald-100 text-emerald-800",
    png: "bg-purple-100 text-purple-800",
    jpg: "bg-purple-100 text-purple-800",
    jpeg: "bg-purple-100 text-purple-800",
    gif: "bg-purple-100 text-purple-800",
    webp: "bg-purple-100 text-purple-800",
    svg: "bg-purple-100 text-purple-800",
    mp4: "bg-pink-100 text-pink-800",
    avi: "bg-pink-100 text-pink-800",
    mkv: "bg-pink-100 text-pink-800",
    webm: "bg-pink-100 text-pink-800",
    mp3: "bg-amber-100 text-amber-800",
    wav: "bg-amber-100 text-amber-800",
    ogg: "bg-amber-100 text-amber-800",
    zip: "bg-orange-100 text-orange-800",
    rar: "bg-orange-100 text-orange-800",
    "7z": "bg-orange-100 text-orange-800",
    tar: "bg-orange-100 text-orange-800",
    gz: "bg-orange-100 text-orange-800",
    js: "bg-yellow-100 text-yellow-800",
    ts: "bg-blue-100 text-blue-800",
    py: "bg-sky-100 text-sky-800",
    html: "bg-orange-100 text-orange-800",
    css: "bg-blue-100 text-blue-800",
    json: "bg-zinc-100 text-zinc-800",
};

interface MaterialLineItemProps {
    material: Record<string, unknown>;
    staged?: "edited" | "deleted" | null;
    selectMode?: boolean;
    selected?: boolean;
    onToggleSelect?: () => void;
}

export function MaterialLineItem({ material, staged, selectMode, selected, onToggleSelect }: MaterialLineItemProps) {
    const isMobile = useIsMobile();
    const { openSidebar } = useUIStore();
    const pathname = usePathname();
    const router = useRouter();

    const title = String(material.title ?? "");
    const slug = String(material.slug ?? "");
    const id = String(material.id ?? "");
    const type = String(material.type ?? "other");
    const attachmentCount = Number(material.attachment_count ?? 0);

    // Extract file name from current version info if available
    let fileName = "";
    if (material.current_version_info && typeof material.current_version_info === "object") {
        const vi = material.current_version_info as Record<string, unknown>;
        fileName = vi.file_name ? String(vi.file_name) : "";
    }

    const base = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    const materialPath = `${base}/${slug}`;
    let badgeColor = TYPE_COLORS[type] ?? TYPE_COLORS.other;

    let badgeLabel = TYPE_LABELS[type] ?? type;
    let Icon = TYPE_ICONS[type] ?? File;

    if (type === "document" && fileName) {
        const extMatch = fileName.match(/\.([^.]+)$/);
        if (extMatch && extMatch[1]) {
            const ext = extMatch[1].toLowerCase();
            badgeLabel = ext.toUpperCase();
            if (EXT_ICONS[ext]) {
                Icon = EXT_ICONS[ext];
            }
            if (EXT_COLORS[ext]) {
                badgeColor = EXT_COLORS[ext];
            }
        }
    }

    const iconColorClass = badgeColor.split(" ").find(c => c.startsWith("text-")) || "text-muted-foreground";

    const handleChat = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        openSidebar("chat", { type: "material", id, data: material });
    };

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
        router.push(materialPath);
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
            <Icon className={`h-5 w-5 shrink-0 ${staged === "deleted" ? "text-red-500" : iconColorClass}`} />

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className={`block truncate font-medium ${staged === "deleted" ? "line-through text-red-700 dark:text-red-400" : ""}`}>{title}</span>
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

            <div className="flex shrink-0 items-center gap-1">
                {isMobile ? (
                    <Link href={materialPath} onClick={(e) => e.stopPropagation()}>
                        <Eye className="h-5 w-5 text-muted-foreground" />
                    </Link>
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
                        <Link href={materialPath} className="rounded-md p-2 hover:bg-muted" title="Preview" onClick={(e) => e.stopPropagation()}>
                            <Eye className="h-4 w-4 text-muted-foreground" />
                        </Link>
                    </>
                )}
            </div>
        </div>
    );
}

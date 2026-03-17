"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    Folder,
    FileText,
    Download,
    Calendar,
    User,
    ExternalLink,
    Paperclip,
    Tag,
    HardDrive,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatFileSize, getFileBadgeColor, getFileBadgeLabel } from "@/lib/file-utils";
import { apiFetch } from "@/lib/api-client";

/* -------------------------------------------------------------------------- */
/*  Reusable primitives for a card-sectioned sidebar                          */
/* -------------------------------------------------------------------------- */

function SidebarSection({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={`rounded-lg border bg-muted/30 px-3.5 py-3 dark:bg-muted/10 ${className}`}
        >
            {children}
        </div>
    );
}

function MetaRow({
    icon: Icon,
    label,
    value,
    href,
}: {
    icon: React.ElementType;
    label: string;
    value: React.ReactNode;
    href?: string;
}) {
    const content = (
        <div className="flex items-center gap-2 text-sm">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">{label}</span>
            <span className="ml-auto text-right font-medium truncate max-w-[140px]">
                {value}
            </span>
        </div>
    );

    if (href) {
        return (
            <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="group block transition-colors hover:text-primary"
            >
                {content}
            </a>
        );
    }

    return content;
}

/* -------------------------------------------------------------------------- */
/*  Difficulty indicator                                                       */
/* -------------------------------------------------------------------------- */

function DifficultyDots({ level }: { level: number }) {
    const clamped = Math.max(1, Math.min(5, level));
    const colors = [
        "bg-green-500",
        "bg-lime-500",
        "bg-yellow-500",
        "bg-orange-500",
        "bg-red-500",
    ];
    return (
        <div className="flex items-center gap-1">
            {Array.from({ length: 5 }, (_, i) => (
                <span
                    key={i}
                    className={`inline-block h-2 w-2 rounded-full transition-colors ${
                        i < clamped ? colors[clamped - 1] : "bg-muted-foreground/20"
                    }`}
                />
            ))}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Directory details                                                          */
/* -------------------------------------------------------------------------- */

function DirectoryDetails({ data }: { data: Record<string, unknown> }) {
    const name = String(data.name ?? "");
    const description = data.description ? String(data.description) : null;
    const dirType = String(data.type ?? "folder");
    const metadata = (data.metadata ?? {}) as Record<string, unknown>;
    const childDirCount = Number(data.child_directory_count ?? 0);
    const childMatCount = Number(data.child_material_count ?? 0);
    const totalCount = childDirCount + childMatCount;

    const isModule = dirType === "module";
    const code = metadata.code ? String(metadata.code) : null;
    const syllabusUrl = metadata.syllabus_url ? String(metadata.syllabus_url) : null;
    const difficulty = metadata.difficulty ? Number(metadata.difficulty) : null;
    const examFormatFileKey = metadata.exam_format_file_key
        ? String(metadata.exam_format_file_key)
        : null;
    const rawTags = (data.tags ?? []) as unknown[];
    const tags = Array.isArray(rawTags)
        ? rawTags.map(String).filter(Boolean)
        : [];

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/40">
                    <Folder className="h-4.5 w-4.5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="font-semibold leading-tight">{name}</h3>
                    {code && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {code}
                        </p>
                    )}
                    <Badge variant="outline" className="mt-1.5 text-xs capitalize">
                        {isModule ? "Module" : "Folder"}
                    </Badge>
                </div>
            </div>

            {/* Description */}
            {description && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                    {description}
                </p>
            )}

            {/* Metadata card */}
            <SidebarSection className="space-y-2">
                <MetaRow
                    icon={FileText}
                    label="Items"
                    value={`${totalCount} ${totalCount === 1 ? "item" : "items"}`}
                />
                {isModule && difficulty !== null && (
                    <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Difficulty</span>
                        <span className="ml-auto">
                            <DifficultyDots level={difficulty} />
                        </span>
                    </div>
                )}
            </SidebarSection>

            {/* Links */}
            {isModule && (syllabusUrl || examFormatFileKey) && (
                <SidebarSection className="space-y-2">
                    {syllabusUrl && (
                        <a
                            href={syllabusUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-primary hover:underline"
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Syllabus
                        </a>
                    )}
                    {examFormatFileKey && (
                        <a
                            href={`/api/materials/download-by-key?key=${encodeURIComponent(examFormatFileKey)}`}
                            className="flex items-center gap-2 text-sm text-primary hover:underline"
                        >
                            <FileText className="h-3.5 w-3.5" />
                            Exam Format
                        </a>
                    )}
                </SidebarSection>
            )}

            {/* Tags */}
            {tags.length > 0 && (
                <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <Tag className="h-3 w-3" />
                        Tags
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {tags.map((tag) => (
                            <Badge
                                key={tag}
                                variant="secondary"
                                className="text-xs"
                            >
                                {tag}
                            </Badge>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Material details                                                           */
/* -------------------------------------------------------------------------- */

function AuthorName({ authorId }: { authorId: string | null }) {
    const [name, setName] = useState<string | null>(null);

    useEffect(() => {
        if (!authorId) return;
        let active = true;
        apiFetch<{ display_name: string | null }>(`/users/${authorId}`)
            .then((u) => { if (active) setName(u.display_name ?? "Unknown"); })
            .catch(() => { if (active) setName("Unknown"); });
        return () => { active = false; };
    }, [authorId]);

    if (!authorId) return <span>[deleted]</span>;
    if (!name) return <span className="animate-pulse text-muted-foreground">…</span>;
    return (
        <Link href={`/profile/${authorId}`} className="text-primary hover:underline">
            {name}
        </Link>
    );
}

function MaterialDetails({ data }: { data: Record<string, unknown> }) {
    const title = String(data.title ?? "");
    const description = data.description ? String(data.description) : null;
    const type = String(data.type ?? "other");
    const authorId = data.author_id ? String(data.author_id) : null;
    const downloadCount = Number(data.download_count ?? 0);
    const createdAt = data.created_at
        ? new Date(String(data.created_at))
        : null;
    const parentMaterialId = data.parent_material_id
        ? String(data.parent_material_id)
        : null;
    const rawTags = (data.tags ?? []) as unknown[];
    const tags = Array.isArray(rawTags)
        ? rawTags.map(String).filter(Boolean)
        : [];
    const attachmentCount = Number(data.attachment_count ?? 0);

    const versionInfo = data.current_version_info as Record<
        string,
        unknown
    > | null;
    const fileSize = versionInfo ? Number(versionInfo.file_size ?? 0) : 0;
    const fileName = versionInfo ? String(versionInfo.file_name ?? "") : "";
    const fileMimeType = versionInfo ? String(versionInfo.file_mime_type ?? "") : "";

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                    <FileText className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="font-semibold leading-tight">{title}</h3>
                    <span className={`mt-1.5 inline-block rounded px-1.5 py-0.5 text-xs font-medium ${fileName ? getFileBadgeColor(fileName) : "bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300"}`}>
                        {fileName ? getFileBadgeLabel(fileName, fileMimeType) : type}
                    </span>
                </div>
            </div>

            {/* Description */}
            {description && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                    {description}
                </p>
            )}

            {/* Metadata card */}
            <SidebarSection className="space-y-2.5">
                <MetaRow
                    icon={User}
                    label="Author"
                    value={<AuthorName authorId={authorId} />}
                />
                {fileSize > 0 && (
                    <MetaRow
                        icon={HardDrive}
                        label="Size"
                        value={formatFileSize(fileSize)}
                    />
                )}
                <MetaRow
                    icon={Download}
                    label="Downloads"
                    value={downloadCount}
                />
                {createdAt && (
                    <MetaRow
                        icon={Calendar}
                        label="Created"
                        value={createdAt.toLocaleDateString()}
                    />
                )}
            </SidebarSection>

            {/* Tags */}
            {tags.length > 0 && (
                <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <Tag className="h-3 w-3" />
                        Tags
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {tags.map((tag) => (
                            <Badge
                                key={tag}
                                variant="secondary"
                                className="text-xs"
                            >
                                {tag}
                            </Badge>
                        ))}
                    </div>
                </div>
            )}

            {/* Attachments card */}
            {!parentMaterialId && (
                <Link
                    href={`${typeof window !== "undefined" ? window.location.pathname : ""}/attachments`}
                    className="group flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-3 transition-colors hover:bg-violet-100/70 dark:border-violet-800/50 dark:bg-violet-950/20 dark:hover:bg-violet-950/40"
                >
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-violet-100 text-violet-600 dark:bg-violet-900/50 dark:text-violet-400">
                        <Paperclip className="h-4.5 w-4.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-violet-900 dark:text-violet-200">
                                Attachments
                            </span>
                            {attachmentCount > 0 && (
                                <Badge
                                    variant="secondary"
                                    className="h-5 px-1.5 text-[10px] font-semibold bg-violet-200 text-violet-700 dark:bg-violet-800 dark:text-violet-200"
                                >
                                    {attachmentCount}
                                </Badge>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {attachmentCount > 0
                                ? `${attachmentCount} supplementary file${attachmentCount !== 1 ? "s" : ""}`
                                : "Add supplementary files"}
                        </p>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-violet-400 opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
            )}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Export                                                                      */
/* -------------------------------------------------------------------------- */

interface DetailsTabProps {
    target: {
        type: "directory" | "material";
        id: string;
        data: Record<string, unknown>;
    } | null;
}

export function DetailsTab({ target }: DetailsTabProps) {
    if (!target) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileText className="mb-3 h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                    Select an item to view details.
                </p>
            </div>
        );
    }

    if (target.type === "directory") {
        return <DirectoryDetails data={target.data} />;
    }

    return <MaterialDetails data={target.data} />;
}

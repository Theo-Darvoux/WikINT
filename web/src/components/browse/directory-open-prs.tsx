"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import {
    GitPullRequest,
    FilePlus,
    FilePenLine,
    FileX,
    FolderPlus,
    FolderPen,
    FolderX,
    ArrowRightLeft,
    ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const OP_ICONS: Record<string, React.ElementType> = {
    create_material: FilePlus,
    edit_material: FilePenLine,
    delete_material: FileX,
    create_directory: FolderPlus,
    edit_directory: FolderPen,
    delete_directory: FolderX,
    move_item: ArrowRightLeft,
};

interface PR {
    id: string;
    title: string;
    status: string;
    type: string;
    summary_types?: string[];
    author: { id: string; display_name: string } | null;
    created_at: string;
    vote_score: number;
}

interface DirectoryOpenPRsProps {
    directoryId: string;
}

export function DirectoryOpenPRs({ directoryId }: DirectoryOpenPRsProps) {
    const [prs, setPrs] = useState<PR[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!directoryId) {
            setLoading(false);
            return;
        }

        let cancelled = false;

        async function fetchPRs() {
            try {
                const data = await apiFetch<PR[]>(
                    `/pull-requests/for-item?targetType=directory&targetId=${directoryId}`,
                );
                if (!cancelled) setPrs(data);
            } catch {
                // Silently ignore — not critical
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        setLoading(true);
        fetchPRs();
        return () => {
            cancelled = true;
        };
    }, [directoryId]);

    if (loading || prs.length === 0) return null;

    return (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800/50 dark:bg-amber-950/20">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-200/60 dark:border-amber-800/40">
                <GitPullRequest className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    {prs.length} open pull request{prs.length !== 1 ? "s" : ""}{" "}
                    in this folder
                </span>
            </div>
            <div className="divide-y divide-amber-200/40 dark:divide-amber-800/30">
                {prs.map((pr) => {
                    const types =
                        pr.summary_types && pr.summary_types.length > 0
                            ? pr.summary_types
                            : [pr.type];
                    return (
                        <Link
                            key={pr.id}
                            href={`/pull-requests/${pr.id}`}
                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors group"
                        >
                            <GitPullRequest className="h-4 w-4 shrink-0 text-green-500" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-sm font-medium truncate group-hover:underline">
                                        {pr.title}
                                    </span>
                                    {types.map((t) => {
                                        const Icon = OP_ICONS[t];
                                        return (
                                            <Badge
                                                key={t}
                                                variant="outline"
                                                className="shrink-0 gap-0.5 text-[10px] h-5 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                                            >
                                                {Icon && (
                                                    <Icon className="h-2.5 w-2.5" />
                                                )}
                                                {t
                                                    .split("_")
                                                    .map(
                                                        (w) =>
                                                            w.charAt(0).toUpperCase() +
                                                            w.slice(1),
                                                    )
                                                    .join(" ")}
                                            </Badge>
                                        );
                                    })}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    #{pr.id.slice(0, 8)} &middot;{" "}
                                    {formatDistanceToNow(
                                        new Date(pr.created_at),
                                        { addSuffix: true },
                                    )}{" "}
                                    by{" "}
                                    {pr.author?.display_name || "[deleted]"}
                                    {pr.vote_score !== 0 && (
                                        <span
                                            className={
                                                pr.vote_score > 0
                                                    ? "text-green-600 ml-1.5"
                                                    : "text-red-500 ml-1.5"
                                            }
                                        >
                                            {pr.vote_score > 0 ? "+" : ""}
                                            {pr.vote_score}
                                        </span>
                                    )}
                                </p>
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-amber-400 dark:text-amber-600 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors" />
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}

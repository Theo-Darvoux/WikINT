"use client";

import Link from "next/link";
import {
    Inbox,
    CheckCircle2,
    XCircle,
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
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { type PullRequestOut } from "@/components/home/types";

const OP_ICONS: Record<string, React.ElementType> = {
    create_material: FilePlus,
    edit_material: FilePenLine,
    delete_material: FileX,
    create_directory: FolderPlus,
    edit_directory: FolderPen,
    delete_directory: FolderX,
    move_item: ArrowRightLeft,
};

interface PullRequestProps {
    pr: PullRequestOut;
}

export function PRCard({ pr }: PullRequestProps) {
    const isApproved = pr.status === "approved";
    const isOpen = pr.status === "open";

    const summaryTypes =
        pr.summary_types && pr.summary_types.length > 0
            ? pr.summary_types
            : [pr.type];

    const initials = pr.author?.display_name
        ? pr.author.display_name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()
        : "?";

    const StatusIcon = isOpen
        ? Inbox
        : isApproved
          ? CheckCircle2
          : XCircle;
    const statusColor = isOpen
        ? "text-green-500"
        : isApproved
          ? "text-purple-500"
          : "text-red-500";

    return (
        <Link
            href={`/pull-requests/${pr.id}`}
            className="flex items-center gap-3 px-4 py-3 bg-background hover:bg-accent/40 transition-colors group border-b last:border-b-0"
        >
            {/* Status icon */}
            <StatusIcon className={`h-5 w-5 shrink-0 ${statusColor}`} />

            {/* Content */}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm group-hover:underline truncate">
                        {pr.title}
                    </span>
                    {summaryTypes.map((st) => {
                        const Icon = OP_ICONS[st];
                        return (
                            <Badge
                                key={st}
                                variant="secondary"
                                className="shrink-0 gap-0.5 text-[10px] h-5 font-normal"
                            >
                                {Icon && <Icon className="h-2.5 w-2.5" />}
                                {st
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
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    <span className="font-mono opacity-60">
                        #{pr.id.slice(0, 8)}
                    </span>
                    {" · "}
                    {formatDistanceToNow(new Date(pr.created_at), {
                        addSuffix: true,
                    })}
                </p>
            </div>


            {/* Author avatar */}
            <Avatar size="sm">
                <AvatarFallback className="text-[10px]">
                    {initials}
                </AvatarFallback>
            </Avatar>

            {/* Chevron */}
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        </Link>
    );
}

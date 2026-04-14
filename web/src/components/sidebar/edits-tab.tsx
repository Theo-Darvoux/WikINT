"use client";

import { useEffect, useState } from "react";
import { Loader2, Inbox } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { PRCard } from "@/components/pr/pr-card";
import { type PullRequestOut } from "@/components/home/types";

interface SidebarTarget {
    type: "directory" | "material";
    id: string;
    data: Record<string, unknown>;
}

interface EditsTabProps {
    target: SidebarTarget | null;
}

export function EditsTab({ target }: EditsTabProps) {
    const [prs, setPrs] = useState<PullRequestOut[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!target) return;

        let isActive = true;
        Promise.resolve().then(() => { if (isActive) setLoading(true); });
        apiFetch<PullRequestOut[]>(`/pull-requests/for-item?targetType=${target.type}&targetId=${target.id}`)
            .then(data => {
                if (isActive) setPrs(data);
            })
            .catch(console.error)
            .finally(() => {
                if (isActive) setLoading(false);
            });

        return () => { isActive = false; };
    }, [target]);

    if (!target) {
        return <p className="text-sm text-muted-foreground p-4">Select an item to view edits.</p>;
    }

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (prs.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center">
                <Inbox className="mb-3 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                    No active contributions for this {target.type}.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4 px-1 pb-4">
            <h3 className="font-semibold px-2">Open Edits</h3>
            <div className="flex flex-col gap-3">
                {prs.map((pr) => (
                    <PRCard key={pr.id} pr={pr} />
                ))}
            </div>
        </div>
    );
}

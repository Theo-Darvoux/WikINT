"use client";

import { useEffect, useState } from "react";
import { Folder, FileBox, LayoutList } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

interface DirectoryItem {
    id: string;
    parent_id: string | null;
    name: string;
    slug: string;
    type: "module" | "folder";
    is_system: boolean;
}

export default function AdminDirectoriesPage() {
    const [directories, setDirectories] = useState<DirectoryItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch<DirectoryItem[]>("/admin/directories")
            .then(setDirectories)
            .catch(() => toast.error("Failed to load directories"))
            .finally(() => setLoading(false));
    }, []);

    const buildTree = (items: DirectoryItem[], parentId: string | null = null): React.ReactNode[] => {
        const children = items.filter((i) => i.parent_id === parentId);
        if (children.length === 0) return [];

        return children.map((child) => (
            <div key={child.id} className="ml-6 mt-2 border-l pl-4 border-muted">
                <div className="flex items-center gap-2 group">
                    {child.type === "module" ? (
                        <FileBox className="h-4 w-4 text-primary" />
                    ) : (
                        <Folder className="h-4 w-4 text-blue-500" />
                    )}
                    <span className="text-sm font-medium">{child.name}</span>
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                        ({child.slug})
                    </span>
                    {child.is_system && (
                        <span className="text-[10px] font-medium bg-muted px-1.5 py-0.5 rounded text-muted-foreground uppercase">
                            System
                        </span>
                    )}
                </div>
                {buildTree(items, child.id)}
            </div>
        ));
    };

    if (loading) {
        return <div className="p-6 text-center text-muted-foreground">Loading directories...</div>;
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <LayoutList className="h-5 w-5" />
                    Directory Structure
                </h2>
                <div className="text-sm text-muted-foreground">Read-only view</div>
            </div>

            <div className="rounded-lg border bg-card p-4 overflow-x-auto min-h-[300px]">
                {directories.length === 0 ? (
                    <div className="text-center text-muted-foreground py-12">
                        No directories found.
                    </div>
                ) : (
                    <div className="-ml-6">
                        {buildTree(directories, null)}
                    </div>
                )}
            </div>
        </div>
    );
}

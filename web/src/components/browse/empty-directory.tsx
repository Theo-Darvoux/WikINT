"use client";

import { FolderOpen } from "lucide-react";

export function EmptyDirectory() {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <FolderOpen className="mb-4 h-16 w-16 opacity-30" />
            <p className="text-lg font-medium">No items yet</p>
            <p className="text-sm">This directory is empty.</p>
        </div>
    );
}

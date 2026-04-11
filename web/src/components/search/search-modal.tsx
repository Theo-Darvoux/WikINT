"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderIcon, FileTextIcon, Loader2, Eye, ThumbsUp } from "lucide-react";

import { useSearch } from "./use-search";
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";

export function SearchModal({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const router = useRouter();
    const [query, setQuery] = React.useState("");
    const { results, loading } = useSearch(query);

    const onSelect = (result: {
        browse_path?: string;
        search_type?: string;
        id?: string;
    }) => {
        onOpenChange(false);
        if (result.browse_path) {
            router.push(result.browse_path);
        } else {
            // Fallback to ID-based routing if browse_path is missing
            if (result.search_type === "directory") {
                router.push(`/directories/${result.id}`);
            } else {
                router.push(`/materials/${result.id}`);
            }
        }
    };

    return (
        <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
            <CommandInput
                placeholder="Search materials, directories..."
                value={query}
                onValueChange={setQuery}
            />
            <CommandList>
                <CommandEmpty>
                    {loading ? (
                        <div className="flex items-center justify-center p-4">
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            <span>Searching...</span>
                        </div>
                    ) : (
                        query.trim() === "" ? "Type a command or search..." : "No results found."
                    )}
                </CommandEmpty>

                {results.length > 0 && (
                    <CommandGroup heading="Results">
                        {results.map((result) => (
                            <CommandItem
                                key={`${result.search_type}-${result.id}`}
                                value={`${result.title || result.name} ${result.id}`}
                                onSelect={() => onSelect(result)}
                                className="flex items-center gap-2"
                            >
                                {result.search_type === "directory" ? (
                                    <FolderIcon className="h-4 w-4 text-primary" />
                                ) : (
                                    <FileTextIcon className="h-4 w-4 text-blue-500" />
                                )}
                                <div className="flex flex-col flex-1">
                                    <span className="font-medium">{result.title || result.name}</span>
                                    {result.description && (
                                        <span className="text-xs text-muted-foreground truncate max-w-[300px]">
                                            {result.description}
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-muted-foreground flex items-center gap-2">
                                    {result.search_type === "material" && (
                                        <div className="flex items-center gap-2 mr-1 border-r pr-2">
                                            <span className="flex items-center gap-0.5">
                                                <Eye className="h-3 w-3" />
                                                {result.total_views || 0}
                                                {(result.views_today || 0) > 0 && (
                                                    <span className="text-[10px] font-bold text-orange-500">
                                                        +{result.views_today}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="flex items-center gap-0.5">
                                                <ThumbsUp className={`h-3 w-3 ${(result.is_liked) ? "fill-primary text-primary" : ""}`} />
                                                {result.like_count || 0}
                                            </span>
                                        </div>
                                    )}
                                    {result.module && (
                                        <span className="bg-secondary px-1.5 py-0.5 rounded">
                                            {result.module}
                                        </span>
                                    )}
                                    <span className="capitalize">{result.search_type}</span>
                                </div>
                            </CommandItem>
                        ))}
                    </CommandGroup>
                )}
            </CommandList>
        </CommandDialog>
    );
}

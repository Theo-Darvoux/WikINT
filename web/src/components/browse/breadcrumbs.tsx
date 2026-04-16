"use client";

import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";

interface BreadcrumbItem {
    id: string;
    name: string;
    slug: string;
}

interface BreadcrumbsProps {
    items: BreadcrumbItem[];
    /** When set, appended as ?preview_pr= to preserve preview mode on breadcrumb navigation */
    previewPrId?: string;
}

// Max items to show before collapsing to Home > … > last N
const COLLAPSE_THRESHOLD = 3;
const TAIL_COUNT = 2;

export function Breadcrumbs({ items, previewPrId }: BreadcrumbsProps) {
    const buildPath = (index: number) => {
        const segments = items.slice(0, index + 1).map((item) => item.slug);
        const base = `/browse/${segments.join("/")}`;
        return previewPrId ? `${base}?preview_pr=${previewPrId}` : base;
    };

    const rootHref = previewPrId ? `/browse?preview_pr=${previewPrId}` : "/browse";

    const collapsed = items.length > COLLAPSE_THRESHOLD;
    // Which items to actually render: when collapsed, only the last TAIL_COUNT
    const visibleItems = collapsed ? items.slice(-TAIL_COUNT) : items;
    // Global index of the first visible item (needed for buildPath)
    const visibleOffset = collapsed ? items.length - TAIL_COUNT : 0;

    return (
        <nav className="flex items-center gap-1 text-sm min-w-0">
            <Link href={rootHref} className="flex items-center shrink-0 text-muted-foreground hover:text-foreground">
                <Home className="h-4 w-4" />
            </Link>

            {collapsed && (
                <span className="flex items-center gap-1 shrink-0">
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    <span
                        className="text-muted-foreground select-none"
                        title={items
                            .slice(0, items.length - TAIL_COUNT)
                            .map((i) => i.name)
                            .join(" › ")}
                    >
                        …
                    </span>
                </span>
            )}

            {visibleItems.map((item, localIndex) => {
                const globalIndex = visibleOffset + localIndex;
                const isLast = globalIndex === items.length - 1;

                return (
                    <span key={item.id} className="flex items-center gap-1 min-w-0">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {isLast ? (
                            <span className="truncate font-medium">{item.name}</span>
                        ) : (
                            <Link
                                href={buildPath(globalIndex)}
                                className="truncate text-muted-foreground hover:text-foreground"
                            >
                                {item.name}
                            </Link>
                        )}
                    </span>
                );
            })}
        </nav>
    );
}

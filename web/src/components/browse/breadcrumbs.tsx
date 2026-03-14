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
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
    const buildPath = (index: number) => {
        const segments = items.slice(0, index + 1).map((item) => item.slug);
        return `/browse/${segments.join("/")}`;
    };

    return (
        <nav className="flex items-center gap-1 overflow-x-auto text-sm">
            <Link href="/browse" className="flex items-center text-muted-foreground hover:text-foreground">
                <Home className="h-4 w-4" />
            </Link>
            {items.map((item, index) => (
                <span key={item.id} className="flex items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {index === items.length - 1 ? (
                        <span className="truncate font-medium">{item.name}</span>
                    ) : (
                        <Link
                            href={buildPath(index)}
                            className="truncate text-muted-foreground hover:text-foreground"
                        >
                            {item.name}
                        </Link>
                    )}
                </span>
            ))}
        </nav>
    );
}

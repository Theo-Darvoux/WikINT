import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
    title: string;
    subtitle?: string;
    seeAllHref?: string;
    seeAllLabel?: string;
    className?: string;
}

export function SectionHeader({
    title,
    subtitle,
    seeAllHref,
    seeAllLabel = "See all",
    className,
}: SectionHeaderProps) {
    return (
        <div className={cn("flex items-start justify-between gap-4", className)}>
            <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">
                    {title}
                </h2>
                {subtitle && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
                )}
            </div>

            {seeAllHref && (
                <Link
                    href={seeAllHref}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                    {seeAllLabel}
                    <ArrowRight className="h-3.5 w-3.5" />
                </Link>
            )}
        </div>
    );
}

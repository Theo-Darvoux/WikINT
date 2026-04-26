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

import { useTranslations } from "next-intl";

export function SectionHeader({
  title,
  subtitle,
  seeAllHref,
  seeAllLabel,
  className,
}: SectionHeaderProps) {
  const t = useTranslations("Home");
  const defaultSeeAllLabel = seeAllLabel || t("seeAll");

  return (
    <div className={cn("space-y-0.5", className)}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">
          {title}
        </h2>

        {seeAllHref && (
          <Link
            href={seeAllHref}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {defaultSeeAllLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { MaterialCard } from "./material-card";
import { SectionHeader } from "./section-header";
import type { MaterialDetail } from "./types";
import { useTranslations } from "next-intl";

const MAX_CARDS = 8;
const SKELETON_COUNT = 4;

interface PopularSectionProps {
  title: string;
  subtitle?: string;
  materials: MaterialDetail[];
  seeAllHref: string;
  isLoading?: boolean;
}

function SkeletonCard() {
  return (
    <div className="w-55 flex-none sm:w-full rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Preview skeleton */}
      <Skeleton className="aspect-4/3 w-full rounded-none" />
      {/* Body skeleton */}
      <div className="p-3 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex gap-3 pt-1">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-10" />
        </div>
      </div>
    </div>
  );
}

function SeeAllCard({
  href,
  totalCount,
}: {
  href: string;
  totalCount: number;
}) {
  const t = useTranslations("Home");
  return (
    <Link
      href={href}
      className="block w-45 flex-none sm:w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
      aria-label={t("seeAllMaterials")}
    >
      <div className="flex h-full min-h-50 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/30 p-4 text-center transition-colors hover:bg-muted/60">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <ChevronRight className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{t("seeAll")}</p>
          {totalCount > MAX_CARDS && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              +{totalCount - MAX_CARDS} {t("more")}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

export function PopularSection({
  title,
  subtitle,
  materials,
  seeAllHref,
  isLoading = false,
}: PopularSectionProps) {
  const t = useTranslations("Home");
  const visibleMaterials = materials.slice(0, MAX_CARDS);
  const hasMore = materials.length >= MAX_CARDS;

  return (
    <section aria-label={title}>
      <SectionHeader
        title={title}
        subtitle={subtitle}
        seeAllHref={seeAllHref}
        seeAllLabel={t("seeAll")}
      />

      <div className="mt-4">
        <div className="flex gap-4 overflow-x-auto pb-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-3 sm:overflow-x-visible sm:pb-0 lg:grid-cols-4 xl:grid-cols-5">
          {isLoading ? (
            Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <SkeletonCard key={i} />
            ))
          ) : visibleMaterials.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              {t("nothingHereYet")}
            </p>
          ) : (
            <>
              {visibleMaterials.map((material) => (
                <MaterialCard key={material.id} material={material} />
              ))}

              {hasMore && (
                <SeeAllCard href={seeAllHref} totalCount={materials.length} />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

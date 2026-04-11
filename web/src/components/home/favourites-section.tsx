"use client";

import Link from "next/link";
import { Heart, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { MaterialCard } from "./material-card";
import { SectionHeader } from "./section-header";
import type { MaterialDetail } from "./types";

const MAX_CARDS = 6;
const SKELETON_COUNT = 3;

interface FavouritesSectionProps {
  materials: MaterialDetail[];
  isLoading?: boolean;
}

function SkeletonCard() {
  return (
    <div className="w-[220px] flex-none sm:w-full rounded-xl border bg-card shadow-sm overflow-hidden">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
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

function SeeAllFavouritesCard() {
  return (
    <Link
      href="/profile"
      className="block w-[180px] flex-none sm:w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
      aria-label="See all favourites"
    >
      <div className="flex h-full min-h-[200px] sm:min-h-[150px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/30 p-4 text-center transition-colors hover:bg-muted/60">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <ChevronRight className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">See all</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            View your profile
          </p>
        </div>
      </div>
    </Link>
  );
}

export function FavouritesSection({
  materials,
  isLoading = false,
}: FavouritesSectionProps) {
  // Don't render if not loading and there's nothing to show
  if (!isLoading && materials.length === 0) return null;

  const visibleMaterials = materials.slice(0, MAX_CARDS);
  const hasMore = materials.length >= MAX_CARDS;

  return (
    <section aria-label="Recently favourited materials">
      <SectionHeader
        title="Your Favourites"
        subtitle="Materials you've recently saved"
        seeAllHref="/profile"
        seeAllLabel="View profile"
      />

      {/* Horizontal scroll container */}
      <div className="mt-4">
        <div className="flex gap-4 overflow-x-auto pb-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-3 sm:overflow-x-visible sm:pb-0 lg:grid-cols-4 xl:grid-cols-5">
          {isLoading ? (
            Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <SkeletonCard key={i} />
            ))
          ) : visibleMaterials.length === 0 ? (
            /* Shouldn't normally render (guarded above), but just in case */
            <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
              <Heart className="h-4 w-4 opacity-40" />
              No favourites yet — browse and save materials you like!
            </div>
          ) : (
            <>
              {visibleMaterials.map((material) => (
                <MaterialCard key={material.id} material={material} />
              ))}

              {hasMore && <SeeAllFavouritesCard />}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

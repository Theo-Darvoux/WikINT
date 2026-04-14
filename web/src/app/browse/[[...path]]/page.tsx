"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { AuthGuard } from "@/components/auth-guard";
import { DirectoryListing } from "@/components/browse/directory-listing";
import { MaterialViewer } from "@/components/browse/material-viewer";
import { SharedSidebar } from "@/components/sidebar/shared-sidebar";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useUIStore, useBrowseRefreshStore } from "@/lib/stores";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Eye, X } from "lucide-react";
import Link from "next/link";

interface BrowseResponse {
  type: "directory_listing" | "material" | "attachment_listing";
  directory?: Record<string, unknown> | null;
  directories?: Record<string, unknown>[];
  materials?: Record<string, unknown>[];
  material?: Record<string, unknown>;
  parent_material?: Record<string, unknown> | null;
  breadcrumbs?: { id: string; name: string; slug: string }[];
}

function BrowseSkeleton({ isMaterial = false }: { isMaterial?: boolean }) {
  if (isMaterial) {
    return (
      <div className="flex flex-1 w-full gap-0 px-4 py-6 pb-20 md:pb-6">
        <div className="flex-1 space-y-4 pr-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-md" />
              <div>
                <Skeleton className="h-6 w-48 mb-2" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
            <Skeleton className="h-10 w-28 rounded-md" />
          </div>
          <div className="flex w-full flex-col items-center justify-start py-4 md:py-8">
            {/* A4 proportioned paper skeleton */}
            <div className="flex w-full max-w-4xl aspect-[1/1.414] flex-col rounded bg-white p-8 shadow-sm dark:bg-zinc-950/50">
              <Skeleton className="mb-12 h-10 w-3/4 rounded-md" />
              <div className="space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[90%]" />
                <Skeleton className="h-4 w-[95%]" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[85%]" />
              </div>
              <div className="mt-12 space-y-4">
                <Skeleton className="h-4 w-[92%]" />
                <Skeleton className="h-4 w-[88%]" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[96%]" />
              </div>
            </div>
          </div>
        </div>
        <div className="hidden w-[30%] min-w-[300px] shrink-0 border-l px-4 py-0 md:block">
          <Skeleton className="h-8 w-full mb-4" />
          <Skeleton className="h-24 w-full mb-4" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-6 pb-20 md:pb-6">
      <Skeleton className="h-6 w-48" />
      <div className="divide-y rounded-lg border">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="h-5 w-5 rounded" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const browseCache = new Map<string, BrowseResponse>();
let previousPath: string | null = null;

function BrowseContent() {
  const params = useParams();
  const isDesktop = useIsDesktop();
  const { sidebarOpen, closeSidebar } = useUIStore();
  const refreshCount = useBrowseRefreshStore((s) => s.refreshCount);

  const path = params.path
    ? Array.isArray(params.path)
      ? params.path.join("/")
      : params.path
    : "";

  const getInitialData = () => {
    if (browseCache.has(path)) return browseCache.get(path)!;
    if (previousPath && browseCache.has(previousPath))
      return browseCache.get(previousPath)!;
    return null;
  };

  const [data, setData] = useState<BrowseResponse | null>(getInitialData);
  const [isFetching, setIsFetching] = useState(!browseCache.has(path));
  const [error, setError] = useState<string | null>(null);

  // PR Preview mode
  const searchParams = useSearchParams();
  const previewPrId = searchParams.get("preview_pr");
  const [previewPr, setPreviewPr] = useState<{
    id: string;
    title: string;
    payload: any[];
  } | null>(null);

  useEffect(() => {
    if (previewPrId) {
      apiFetch<any>(`/pull-requests/${previewPrId}`)
        .then((pr) => {
          setPreviewPr({
            id: pr.id,
            title: pr.title,
            payload: pr.payload,
          });
        })
        .catch(() => setPreviewPr(null));
    } else {
      setPreviewPr(null);
    }
  }, [previewPrId]);

  const fetchData = useCallback(
    async (isBackground = false) => {
      if (!isBackground) setIsFetching(true);
      setError(null);
      try {
        const endpoint = path ? `/browse/${path}` : "/browse";
        const result = await apiFetch<BrowseResponse>(endpoint);
        browseCache.set(path, result);
        previousPath = path;
        setData(result);
      } catch (err) {
        if (!isBackground) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setData(null);
        }
      } finally {
        if (!isBackground) setIsFetching(false);
      }
    },
    [path],
  );

  useEffect(() => {
    // If path changed, it's a fresh load
    closeSidebar();
    fetchData(false);
  }, [path, fetchData, closeSidebar]);

  useEffect(() => {
    if (data) {
      if (data.type === "material" && data.material) {
        document.title = `${data.material.title} • WikINT`;
      } else if (data.directory) {
        document.title = `${data.directory.name as string} • WikINT`;
      } else if (path === "") {
        document.title = "Course Materials • WikINT";
      }
    }
  }, [data, path]);

  useEffect(() => {
    // If refreshCount changed but path didn't, it's a background refresh
    if (refreshCount > 0) {
      browseCache.delete(path);
      fetchData(true);
    }
  }, [path, refreshCount, fetchData]);

  const isLikelyMaterial = Boolean(
    params.path && Array.isArray(params.path) && params.path.length >= 3,
  );

  if (!data && isFetching)
    return <BrowseSkeleton isMaterial={isLikelyMaterial} />;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-muted-foreground">
        <p className="text-lg font-medium">Not found</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const isDirectoryView =
    data.type === "directory_listing" || data.type === "attachment_listing";

  if (data.type === "material" && data.material) {
    return (
      <MaterialViewer material={data.material} breadcrumbs={data.breadcrumbs} />
    );
  }

  return (
    <div
      className={`flex flex-1 overflow-hidden gap-0 transition-opacity duration-200 ${isFetching ? "opacity-50 pointer-events-none" : "opacity-100"}`}
    >
      <div
        className={`flex-1 min-h-0 overflow-y-auto px-4 py-6 pb-20 md:pb-6 ${isDesktop && sidebarOpen ? "min-w-0" : ""}`}
      >
        {previewPr && (
          <div className="mb-6 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-3 dark:border-blue-800/40 dark:bg-blue-950/20">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
                <Eye className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                  Contribution preview
                </h3>
                <p className="text-xs text-muted-foreground truncate">
                  {previewPr.title}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/50"
              asChild
            >
              <Link href={path ? `/browse/${path}` : "/browse"}>
                <X className="h-4 w-4" />
                Exit preview
              </Link>
            </Button>
          </div>
        )}

        {isDirectoryView && (
          <DirectoryListing
            directory={data.directory ?? null}
            directories={data.directories ?? []}
            materials={data.materials ?? []}
            breadcrumbs={data.breadcrumbs}
            isAttachmentListing={data.type === "attachment_listing"}
            parentMaterial={data.parent_material ?? null}
            previewOperations={previewPr?.payload}
            previewPrId={previewPr?.id}
          />
        )}
      </div>
      {!isDesktop && <SharedSidebar />}
      {isDesktop && sidebarOpen && isDirectoryView && (
        <div className="w-80 shrink-0 border-l bg-background">
          <SharedSidebar />
        </div>
      )}
    </div>
  );
}

export default function BrowsePage() {
  return (
    <AuthGuard requireOnboarded>
      <BrowseContent />
    </AuthGuard>
  );
}

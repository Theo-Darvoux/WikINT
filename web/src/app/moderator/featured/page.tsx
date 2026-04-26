"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Star, CalendarRange, ExternalLink, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useSearch } from "@/components/search/use-search";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import Link from "next/link";
import type { FeaturedItem } from "@/components/home/types";

type FeaturedStatus = "active" | "scheduled" | "expired";

function getFeaturedStatus(item: FeaturedItem): FeaturedStatus {
  const now = new Date();
  const start = new Date(item.start_at);
  const end = new Date(item.end_at);
  if (now < start) return "scheduled";
  if (now > end) return "expired";
  return "active";
}

const STATUS_STYLES: Record<FeaturedStatus, string> = {
  active:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  expired: "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
};

function formatDateRange(startAt: string, endAt: string): string {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  return `${fmt(startAt)} → ${fmt(endAt)}`;
}

function toLocalDateInput(isoString?: string | Date): string {
  const d = isoString ? new Date(isoString) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function MaterialSearch({ onSelect }: { onSelect: (id: string, title: string) => void }) {
  const t = useTranslations("Moderator.featured");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { results, loading } = useSearch(query);
  const [selectedTitle, setSelectedTitle] = useState("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal h-10 px-3"
        >
          <span className="truncate">
            {selectedTitle || <span className="text-muted-foreground">{t("dialog.searchPlaceholder")}</span>}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("dialog.searchPlaceholder")}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[300px]">
            {loading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">{t("dialog.searchPlaceholder")}</span>
              </div>
            )}
            {!loading && results.length === 0 && query.length > 0 && <CommandEmpty>{t("dialog.noResults")}</CommandEmpty>}
            {!loading && results.length === 0 && query.length === 0 && <CommandEmpty className="py-6 text-muted-foreground">{t("dialog.startTyping")}</CommandEmpty>}
            <CommandGroup>
              {results.filter(r => r.search_type === "material").map((result) => {
                const title = result.title || result.file_name || "Untitled";
                return (
                  <CommandItem
                    key={result.id}
                    value={result.id}
                    onSelect={() => {
                      setSelectedTitle(title);
                      onSelect(result.id, title);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedTitle === title ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col overflow-hidden">
                      <span className="font-medium truncate">{title}</span>
                      <span className="text-[10px] text-muted-foreground font-mono truncate">{result.id}</span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface AddFeaturedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function AddFeaturedDialog({ open, onOpenChange, onSuccess }: AddFeaturedDialogProps) {
  const t = useTranslations("Moderator.featured");
  const [materialId, setMaterialId] = useState("");
  const [titleOverride, setTitleOverride] = useState("");
  const [descOverride, setDescOverride] = useState("");
  const [startAt, setStartAt] = useState(toLocalDateInput());
  const [endAt, setEndAt] = useState("");
  const [priority, setPriority] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setMaterialId("");
    setTitleOverride("");
    setDescOverride("");
    setStartAt(toLocalDateInput());
    setEndAt("");
    setPriority(0);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    if (!materialId.trim()) { toast.error(t("errors.materialRequired")); return; }
    if (!startAt) { toast.error(t("errors.startRequired")); return; }
    if (!endAt) { toast.error(t("errors.endRequired")); return; }
    if (new Date(endAt) <= new Date(startAt)) { toast.error(t("errors.endAfterStart")); return; }

    setSubmitting(true);
    try {
      const startIso = new Date(`${startAt}T00:00:00`).toISOString();
      const endIso = new Date(`${endAt}T23:59:59`).toISOString();

      const payload: Record<string, unknown> = {
        material_id: materialId.trim(),
        start_at: startIso,
        end_at: endIso,
        priority,
      };
      if (titleOverride.trim()) payload.title = titleOverride.trim();
      if (descOverride.trim()) payload.description = descOverride.trim();

      await apiFetch("/moderator/featured", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      toast.success(t("success.added"));
      handleOpenChange(false);
      onSuccess();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("errors.addFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("dialog.addTitle")}</DialogTitle>
          <DialogDescription>
            {t("dialog.addDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="material-search">{t("dialog.searchMaterial")} <span className="text-destructive" aria-hidden>*</span></Label>
            <MaterialSearch onSelect={(id) => {
              setMaterialId(id);
            }} />
            {materialId && (
              <p className="text-[10px] text-muted-foreground font-mono mt-1">
                {t("dialog.selectedId", { id: materialId })}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title-override">{t("dialog.titleOverride")}</Label>
            <Input
              id="title-override"
              placeholder={t("dialog.titleOverridePlaceholder")}
              value={titleOverride}
              onChange={(e) => setTitleOverride(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="desc-override">{t("dialog.descOverride")}</Label>
            <Textarea
              id="desc-override"
              placeholder={t("dialog.descOverridePlaceholder")}
              value={descOverride}
              onChange={(e) => setDescOverride(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start-at">{t("dialog.startDate")} <span className="text-destructive" aria-hidden>*</span></Label>
              <Input id="start-at" type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              <p className="text-[10px] text-muted-foreground italic">{t("dialog.startsAt")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end-at">{t("dialog.endDate")} <span className="text-destructive" aria-hidden>*</span></Label>
              <Input id="end-at" type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              <p className="text-[10px] text-muted-foreground italic">{t("dialog.endsAt")}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="priority">{t("dialog.priority")}</Label>
            <Input
              id="priority"
              type="number"
              min={0}
              placeholder="0"
              value={priority}
              onChange={(e) => setPriority(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">{t("dialog.priorityDesc")}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>{t("dialog.cancel")}</Button>
          <Button onClick={handleSubmit} disabled={submitting}>{submitting ? t("dialog.adding") : t("addFeatured")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ModeratorFeaturedPage() {
  const t = useTranslations("Moderator.featured");
  const [items, setItems] = useState<FeaturedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { show } = useConfirmDialog();

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<FeaturedItem[]>("/moderator/featured");
      const order: Record<FeaturedStatus, number> = { active: 0, scheduled: 1, expired: 2 };
      data.sort((a, b) => {
        const statusDiff = order[getFeaturedStatus(a)] - order[getFeaturedStatus(b)];
        if (statusDiff !== 0) return statusDiff;
        return b.priority - a.priority;
      });
      setItems(data);
    } catch {
      toast.error(t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleDelete = (item: FeaturedItem) => {
    show(
      t("delete.confirmTitle"),
      t("delete.confirmDesc", { title: item.title ?? item.material.title }),
      async () => {
        try {
          await apiFetch(`/moderator/featured/${item.id}`, { method: "DELETE" });
          setItems((prev) => prev.filter((i) => i.id !== item.id));
          toast.success(t("delete.success"));
        } catch {
          toast.error(t("delete.error"));
        }
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {t.rich("description", {
            featured: (chunks) => <strong className="font-medium text-foreground">{chunks}</strong>
          })}
        </p>
        <Button size="sm" className="shrink-0" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("addFeatured")}
        </Button>
      </div>

      <AddFeaturedDialog open={dialogOpen} onOpenChange={setDialogOpen} onSuccess={fetchItems} />

      <div className="rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-4 font-medium">{t("table.material")}</th>
                <th className="p-4 font-medium">{t("table.titleOverride")}</th>
                <th className="p-4 font-medium">{t("table.status")}</th>
                <th className="p-4 font-medium">
                  <span className="flex items-center gap-1.5">
                    <CalendarRange className="h-3.5 w-3.5" />
                    {t("table.period")}
                  </span>
                </th>
                <th className="p-4 font-medium text-center">{t("table.priority")}</th>
                <th className="p-4 font-medium text-right">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && items.length === 0 && (
                <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">{t("loading")}</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-10 text-center">
                    <Star className="mx-auto mb-3 h-9 w-9 text-muted-foreground/20" />
                    <p className="text-sm font-medium text-muted-foreground">{t("noItems")}</p>
                    <p className="mt-1 text-xs text-muted-foreground/70">{t("noItemsDesc")}</p>
                  </td>
                </tr>
              )}
              {items.map((item) => {
                const status = getFeaturedStatus(item);
                const materialTitle = item.material.title;
                const statusKey = `status.${status}` as const;
                return (
                  <tr key={item.id} className="transition-colors hover:bg-muted/30">
                    <td className="p-4">
                      <div className="space-y-0.5">
                        <p className="font-medium leading-snug">{materialTitle}</p>
                        <div className="flex items-center gap-1.5">
                          <code className="text-[11px] text-muted-foreground font-mono">{item.material.id.slice(0, 8)}…</code>
                          <Link
                            href={item.material.directory_path ? `/browse/${item.material.directory_path}/${item.material.slug}` : `/browse/${item.material.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                            {t("view")}
                          </Link>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      {item.title ? (
                        <span className="line-clamp-1 max-w-45">{item.title}</span>
                      ) : (
                        <span className="italic text-muted-foreground/50 text-xs">{t("dialog.usesMaterialTitle")}</span>
                      )}
                    </td>
                    <td className="p-4">
                      <span className={["inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLES[status]].join(" ")}>
                        {status === "active" && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />}
                        {t(statusKey)}
                      </span>
                    </td>
                    <td className="p-4 text-xs text-muted-foreground">{formatDateRange(item.start_at, item.end_at)}</td>
                    <td className="p-4 text-center">
                      <Badge variant="secondary" className="tabular-nums min-w-8 justify-center">{item.priority}</Badge>
                    </td>
                    <td className="p-4 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(item)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        title={t("delete.confirmTitle")}
                        aria-label={t("delete.confirmTitle")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && items.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          {t("stats", {
            active: items.filter((i) => getFeaturedStatus(i) === "active").length,
            scheduled: items.filter((i) => getFeaturedStatus(i) === "scheduled").length,
            expired: items.filter((i) => getFeaturedStatus(i) === "expired").length,
          })}
        </p>
      )}
    </div>
  );
}

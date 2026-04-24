"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Star, CalendarRange, ExternalLink, Check, ChevronsUpDown, Search, Loader2 } from "lucide-react";
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
            {selectedTitle || <span className="text-muted-foreground">Search materials...</span>}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type material title..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[300px]">
            {loading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Searching...</span>
              </div>
            )}
            {!loading && results.length === 0 && query.length > 0 && <CommandEmpty>No materials found.</CommandEmpty>}
            {!loading && results.length === 0 && query.length === 0 && <CommandEmpty className="py-6 text-muted-foreground">Start typing to search...</CommandEmpty>}
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
  const [materialId, setMaterialId] = useState("");
  const [materialTitle, setMaterialTitle] = useState("");
  const [titleOverride, setTitleOverride] = useState("");
  const [descOverride, setDescOverride] = useState("");
  const [startAt, setStartAt] = useState(toLocalDateInput());
  const [endAt, setEndAt] = useState("");
  const [priority, setPriority] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setMaterialId("");
    setMaterialTitle("");
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
    if (!materialId.trim()) { toast.error("Material ID is required"); return; }
    if (!startAt) { toast.error("Start date is required"); return; }
    if (!endAt) { toast.error("End date is required"); return; }
    if (new Date(endAt) <= new Date(startAt)) { toast.error("End date must be after start date"); return; }

    setSubmitting(true);
    try {
      // Format dates to include default times: start of day for startAt, end of day for endAt
      // We use local time by constructing the string carefully then converting to ISO
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

      toast.success("Featured item added successfully");
      handleOpenChange(false);
      onSuccess();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add featured item");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Featured Material</DialogTitle>
          <DialogDescription>
            Feature a material on the home page for a specified time window.
            Higher priority items appear first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="material-search">Search Material <span className="text-destructive" aria-hidden>*</span></Label>
            <MaterialSearch onSelect={(id, title) => {
              setMaterialId(id);
              setMaterialTitle(title);
            }} />
            {materialId && (
              <p className="text-[10px] text-muted-foreground font-mono mt-1">
                Selected: {materialId}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title-override">Title Override</Label>
            <Input
              id="title-override"
              placeholder="Leave blank to use the material's own title"
              value={titleOverride}
              onChange={(e) => setTitleOverride(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="desc-override">Description Override</Label>
            <Textarea
              id="desc-override"
              placeholder="Leave blank to use the material's own description"
              value={descOverride}
              onChange={(e) => setDescOverride(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start-at">Start Date <span className="text-destructive" aria-hidden>*</span></Label>
              <Input id="start-at" type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              <p className="text-[10px] text-muted-foreground italic">Starts at 00:00</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end-at">End Date <span className="text-destructive" aria-hidden>*</span></Label>
              <Input id="end-at" type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              <p className="text-[10px] text-muted-foreground italic">Ends at 23:59</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="priority">Priority</Label>
            <Input
              id="priority"
              type="number"
              min={0}
              placeholder="0"
              value={priority}
              onChange={(e) => setPriority(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">Higher numbers appear first when multiple items are active.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Adding…" : "Add Featured"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ModeratorFeaturedPage() {
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
      toast.error("Failed to load featured items");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleDelete = (item: FeaturedItem) => {
    show(
      "Remove featured item?",
      `"${item.title ?? item.material.title}" will be removed from the featured section immediately.`,
      async () => {
        try {
          await apiFetch(`/moderator/featured/${item.id}`, { method: "DELETE" });
          setItems((prev) => prev.filter((i) => i.id !== item.id));
          toast.success("Featured item removed");
        } catch {
          toast.error("Failed to remove featured item");
        }
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Manage which materials appear in the{" "}
          <strong className="font-medium text-foreground">Featured</strong>{" "}
          section on the home page.
        </p>
        <Button size="sm" className="shrink-0" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Featured
        </Button>
      </div>

      <AddFeaturedDialog open={dialogOpen} onOpenChange={setDialogOpen} onSuccess={fetchItems} />

      <div className="rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-4 font-medium">Material</th>
                <th className="p-4 font-medium">Title Override</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium">
                  <span className="flex items-center gap-1.5">
                    <CalendarRange className="h-3.5 w-3.5" />
                    Period
                  </span>
                </th>
                <th className="p-4 font-medium text-center">Priority</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && items.length === 0 && (
                <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">Loading featured items…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-10 text-center">
                    <Star className="mx-auto mb-3 h-9 w-9 text-muted-foreground/20" />
                    <p className="text-sm font-medium text-muted-foreground">No featured items yet</p>
                    <p className="mt-1 text-xs text-muted-foreground/70">Click &ldquo;Add Featured&rdquo; to highlight a material on the home page.</p>
                  </td>
                </tr>
              )}
              {items.map((item) => {
                const status = getFeaturedStatus(item);
                const materialTitle = item.material.title;
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
                            View
                          </Link>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      {item.title ? (
                        <span className="line-clamp-1 max-w-45">{item.title}</span>
                      ) : (
                        <span className="italic text-muted-foreground/50 text-xs">— (uses material title)</span>
                      )}
                    </td>
                    <td className="p-4">
                      <span className={["inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLES[status]].join(" ")}>
                        {status === "active" && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />}
                        {status.charAt(0).toUpperCase() + status.slice(1)}
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
                        title={`Remove "${materialTitle}" from featured`}
                        aria-label={`Remove "${materialTitle}" from featured`}
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
          {items.filter((i) => getFeaturedStatus(i) === "active").length} active
          · {items.filter((i) => getFeaturedStatus(i) === "scheduled").length} scheduled
          · {items.filter((i) => getFeaturedStatus(i) === "expired").length} expired
        </p>
      )}
    </div>
  );
}

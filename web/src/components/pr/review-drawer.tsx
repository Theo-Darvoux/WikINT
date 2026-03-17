"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    FilePlus,
    FilePenLine,
    FileX,
    FolderPlus,
    FolderPen,
    FolderX,
    ArrowRightLeft,
    Trash2,
    Loader2,
    Send,
    ChevronDown,
    X,
    Plus,
    Paperclip,
    AlertTriangle,
    Clock,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import {
    useStagingStore,
    opLabel,
    type Operation,
    type StagedOperation,
    isExpired,
    isExpiringSoon,
    msUntilExpiry,
    formatTimeRemaining,
    hasFileKey,
    unwrapOp,
} from "@/lib/staging-store";

const OP_ICONS: Record<string, React.ElementType> = {
    create_material: FilePlus,
    edit_material: FilePenLine,
    delete_material: FileX,
    create_directory: FolderPlus,
    edit_directory: FolderPen,
    delete_directory: FolderX,
    move_item: ArrowRightLeft,
};

const OP_COLORS: Record<string, string> = {
    create_material: "text-green-600 dark:text-green-400",
    edit_material: "text-blue-600 dark:text-blue-400",
    delete_material: "text-red-500 dark:text-red-400",
    create_directory: "text-green-600 dark:text-green-400",
    edit_directory: "text-blue-600 dark:text-blue-400",
    delete_directory: "text-red-500 dark:text-red-400",
    move_item: "text-amber-600 dark:text-amber-400",
};

const MATERIAL_TYPES = [
    { value: "document", label: "Document" },
    { value: "polycopie", label: "Polycopié" },
    { value: "annal", label: "Annale" },
    { value: "cheatsheet", label: "Cheatsheet" },
    { value: "tip", label: "Tip" },
    { value: "review", label: "Review" },
    { value: "discussion", label: "Discussion" },
    { value: "video", label: "Video" },
    { value: "other", label: "Other" },
];

interface AttachmentData {
    title: string;
    type: string;
    description?: string | null;
    tags?: string[];
    file_key?: string | null;
    file_name?: string | null;
    file_size?: number | null;
}

function TagChipInput({
    value,
    onChange,
}: {
    value: string[];
    onChange: (tags: string[]) => void;
}) {
    const [inputVal, setInputVal] = useState("");

    const addTag = (raw: string) => {
        const tag = raw.trim().toLowerCase();
        if (tag && !value.includes(tag)) onChange([...value, tag]);
        setInputVal("");
    };

    return (
        <div className="flex flex-wrap gap-1 rounded-md border px-2 py-1.5 min-h-9 focus-within:ring-1 focus-within:ring-ring">
            {value.map((tag) => (
                <span
                    key={tag}
                    className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                >
                    {tag}
                    <button
                        type="button"
                        onClick={() =>
                            onChange(value.filter((t) => t !== tag))
                        }
                    >
                        <X className="h-2.5 w-2.5" />
                    </button>
                </span>
            ))}
            <input
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => {
                    if (
                        e.key === "Enter" ||
                        e.key === "," ||
                        e.key === " "
                    ) {
                        e.preventDefault();
                        addTag(inputVal);
                    } else if (
                        e.key === "Backspace" &&
                        inputVal === "" &&
                        value.length > 0
                    ) {
                        onChange(value.slice(0, -1));
                    }
                }}
                onBlur={() => {
                    if (inputVal.trim()) addTag(inputVal);
                }}
                placeholder={value.length === 0 ? "Add tags…" : ""}
                className="flex-1 min-w-[80px] bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
        </div>
    );
}

function AttachmentRow({
    attachment,
    onUpdate,
    onRemove,
}: {
    attachment: AttachmentData;
    onUpdate: (a: AttachmentData) => void;
    onRemove: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div className="rounded border bg-muted/30">
            <div className="flex items-center gap-2 px-2 py-1.5">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-xs font-medium">
                    {attachment.title || (
                        <span className="italic text-muted-foreground">
                            Untitled attachment
                        </span>
                    )}
                </span>
                {attachment.file_name && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                        {attachment.file_name}
                    </span>
                )}
                <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setExpanded((v) => !v)}
                >
                    <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${
                            expanded ? "rotate-180" : ""
                        }`}
                    />
                </button>
                <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                    onClick={onRemove}
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
            {expanded && (
                <div className="border-t px-2 pb-2.5 pt-2 space-y-2">
                    <div className="space-y-1">
                        <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Title
                        </label>
                        <Input
                            value={attachment.title}
                            onChange={(e) =>
                                onUpdate({
                                    ...attachment,
                                    title: e.target.value,
                                })
                            }
                            className="h-7 text-xs"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Type
                        </label>
                        <Select
                            value={attachment.type || "document"}
                            onValueChange={(v) =>
                                onUpdate({ ...attachment, type: v })
                            }
                        >
                            <SelectTrigger className="h-7 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {MATERIAL_TYPES.map((t) => (
                                    <SelectItem
                                        key={t.value}
                                        value={t.value}
                                        className="text-xs"
                                    >
                                        {t.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Description
                        </label>
                        <Textarea
                            value={attachment.description ?? ""}
                            onChange={(e) =>
                                onUpdate({
                                    ...attachment,
                                    description: e.target.value || null,
                                })
                            }
                            rows={2}
                            className="text-xs resize-none"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Tags
                        </label>
                        <TagChipInput
                            value={attachment.tags ?? []}
                            onChange={(tags) =>
                                onUpdate({ ...attachment, tags })
                            }
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

function OperationCard({
    staged,
    index,
    onRemove,
}: {
    staged: StagedOperation;
    index: number;
    onRemove: (i: number) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const updateOperation = useStagingStore((s) => s.updateOperation);

    const op = unwrapOp(staged);
    const Icon = OP_ICONS[op.op] ?? FilePlus;
    const color = OP_COLORS[op.op] ?? "";

    const expired = isExpired(staged);
    const expiringSoon = isExpiringSoon(staged);
    const remaining = msUntilExpiry(staged);

    const isDelete =
        op.op === "delete_material" || op.op === "delete_directory";
    const isMove = op.op === "move_item";
    const hasEditable = !isDelete && !isMove;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch = (fields: Record<string, any>) => {
        updateOperation(index, { ...op, ...fields } as Operation);
    };

    const tags: string[] =
        ("tags" in op ? op.tags : null) ?? [];
    const description: string =
        ("description" in op ? op.description : null) ?? "";
    const attachments: AttachmentData[] =
        op.op === "create_material" ? ((op.attachments ?? []) as unknown as AttachmentData[]) : [];

    return (
        <div className={`rounded-lg border transition-colors ${expired ? "border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20" : expiringSoon ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20" : ""}`}>
            <div className="group flex items-center gap-3 p-3">
                <div className={`shrink-0 ${expired ? "text-red-400" : color}`}>
                    <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium leading-tight ${expired ? "line-through text-muted-foreground" : ""}`}>
                        {opLabel(op)}
                    </p>
                    {expired && hasFileKey(op) && (
                        <p className="text-[11px] text-red-500 flex items-center gap-1 mt-0.5">
                            <AlertTriangle className="h-3 w-3" />
                            Upload expired — remove this item
                        </p>
                    )}
                    {expiringSoon && remaining !== null && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                            <Clock className="h-3 w-3" />
                            Upload expires in {formatTimeRemaining(remaining)}
                        </p>
                    )}
                </div>
                {hasEditable && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => setExpanded((v) => !v)}
                    >
                        <ChevronDown
                            className={`h-3.5 w-3.5 transition-transform ${
                                expanded ? "rotate-180" : ""
                            }`}
                        />
                    </Button>
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                    onClick={() => onRemove(index)}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            </div>

            {expanded && hasEditable && (
                <div className="border-t px-3 pb-3 pt-2.5 space-y-3">
                    {/* Title (materials) */}
                    {(op.op === "create_material" ||
                        op.op === "edit_material") && (
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">
                                Title
                            </label>
                            <Input
                                value={op.title ?? ""}
                                onChange={(e) =>
                                    patch({ title: e.target.value })
                                }
                                className="h-8 text-sm"
                            />
                        </div>
                    )}
                    {/* Name (directories) */}
                    {(op.op === "create_directory" ||
                        op.op === "edit_directory") && (
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">
                                Name
                            </label>
                            <Input
                                value={op.name ?? ""}
                                onChange={(e) =>
                                    patch({ name: e.target.value })
                                }
                                className="h-8 text-sm"
                            />
                        </div>
                    )}
                    {/* Description */}
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                            Description
                        </label>
                        <Textarea
                            value={description}
                            onChange={(e) =>
                                patch({
                                    description: e.target.value || null,
                                })
                            }
                            rows={2}
                            className="text-sm resize-none"
                        />
                    </div>
                    {/* Tags */}
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                            Tags
                        </label>
                        <TagChipInput
                            value={tags}
                            onChange={(t) => patch({ tags: t })}
                        />
                    </div>
                    {/* Attachments — only create_material */}
                    {op.op === "create_material" && (
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-muted-foreground">
                                    Attachments
                                </label>
                                <button
                                    type="button"
                                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                                    onClick={() =>
                                        patch({
                                            attachments: [
                                                ...attachments,
                                                {
                                                    title: "",
                                                    type: "document",
                                                    tags: [],
                                                },
                                            ],
                                        })
                                    }
                                >
                                    <Plus className="h-3 w-3" />
                                    Add
                                </button>
                            </div>
                            {attachments.length === 0 && (
                                <p className="text-xs text-muted-foreground italic">
                                    No attachments
                                </p>
                            )}
                            <div className="space-y-1">
                                {attachments.map((att, ai) => (
                                    <AttachmentRow
                                        key={ai}
                                        attachment={att as AttachmentData}
                                        onUpdate={(updated) => {
                                            const next = [...attachments];
                                            next[ai] = updated;
                                            patch({ attachments: next });
                                        }}
                                        onRemove={() =>
                                            patch({
                                                attachments: attachments.filter(
                                                    (_, idx) => idx !== ai,
                                                ),
                                            })
                                        }
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export function ReviewDrawer() {
    const router = useRouter();
    const operations = useStagingStore((s) => s.operations) ?? [];
    const reviewOpen = useStagingStore((s) => s.reviewOpen);
    const setReviewOpen = useStagingStore((s) => s.setReviewOpen);
    const removeOperation = useStagingStore((s) => s.removeOperation);
    const clearOperations = useStagingStore((s) => s.clearOperations);
    const clearUploads = useStagingStore((s) => s.clearUploads);
    const purgeExpired = useStagingStore((s) => s.purgeExpired);

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const expiredCount = operations.filter((s) => isExpired(s)).length;
    const expiringSoonCount = operations.filter((s) => isExpiringSoon(s)).length;
    const hasExpired = expiredCount > 0;

    const canSubmit =
        title.trim().length >= 3 && operations.length > 0 && !submitting && !hasExpired;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        try {
            const result = await apiFetch<{ id: string; status: string }>(
                "/pull-requests",
                {
                    method: "POST",
                    body: JSON.stringify({
                        title: title.trim(),
                        description: description.trim() || null,
                        operations: operations.map((s) => unwrapOp(s)),
                    }),
                },
            );

            clearOperations();
            clearUploads();
            setTitle("");
            setDescription("");
            setReviewOpen(false);

            if (result.status === "approved") {
                toast.success("Changes applied immediately (auto-approved)");
            } else {
                toast.success("Pull request created successfully");
            }
            router.push(`/pull-requests/${result.id}`);
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "Failed to submit",
            );
        } finally {
            setSubmitting(false);
        }
    };

    const handleClear = () => {
        clearOperations();
        clearUploads();
        setReviewOpen(false);
        toast("Staged changes cleared");
    };

    // Summarize operation types
    const typeCounts = operations.reduce(
        (acc, staged) => {
            const innerOp = unwrapOp(staged);
            acc[innerOp.op] = (acc[innerOp.op] || 0) + 1;
            return acc;
        },
        {} as Record<string, number>,
    );

    return (
        <Sheet open={reviewOpen} onOpenChange={setReviewOpen}>
            <SheetContent side="right" className="flex w-full flex-col overflow-hidden sm:max-w-lg">
                <SheetHeader className="space-y-1">
                    <SheetTitle className="flex items-center gap-2">
                        Review Changes
                        <Badge variant="secondary" className="text-xs">
                            {operations.length} operation
                            {operations.length !== 1 ? "s" : ""}
                        </Badge>
                    </SheetTitle>
                    <SheetDescription>
                        Review your staged changes and submit as a pull request.
                    </SheetDescription>
                </SheetHeader>

                {/* Summary badges */}
                {Object.keys(typeCounts).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-1">
                        {Object.entries(typeCounts).map(([type, count]) => {
                            const Icon = OP_ICONS[type] ?? FilePlus;
                            const color = OP_COLORS[type] ?? "";
                            return (
                                <Badge
                                    key={type}
                                    variant="outline"
                                    className="gap-1 text-xs"
                                >
                                    <Icon className={`h-3 w-3 ${color}`} />
                                    {count}
                                </Badge>
                            );
                        })}
                    </div>
                )}

                <Separator />

                {/* Expiry banner */}
                {hasExpired && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-red-700 dark:text-red-400">
                                {expiredCount} upload{expiredCount !== 1 ? "s" : ""} expired
                            </p>
                            <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-0.5">
                                Uploaded files are deleted after 24 hours. Remove expired items or re-upload to continue.
                            </p>
                            <Button
                                variant="outline"
                                size="sm"
                                className="mt-2 h-7 text-xs border-red-300 text-red-600 hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/50"
                                onClick={() => {
                                    const removed = purgeExpired();
                                    toast(`Removed ${removed} expired operation${removed !== 1 ? "s" : ""}`);
                                }}
                            >
                                <Trash2 className="mr-1.5 h-3 w-3" />
                                Remove expired
                            </Button>
                        </div>
                    </div>
                )}
                {!hasExpired && expiringSoonCount > 0 && (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30">
                        <Clock className="h-4 w-4 shrink-0 text-amber-500" />
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                            {expiringSoonCount} upload{expiringSoonCount !== 1 ? "s" : ""} expiring soon — submit before they expire
                        </p>
                    </div>
                )}

                {/* Operations list */}
                <ScrollArea className="min-h-0 flex-1 -mx-6 px-6">
                    <div className="space-y-2 py-1">
                        {operations.map((staged, i) => (
                            <OperationCard
                                key={i}
                                staged={staged}
                                index={i}
                                onRemove={removeOperation}
                            />
                        ))}
                        {operations.length === 0 && (
                            <p className="py-8 text-center text-sm text-muted-foreground">
                                No changes staged yet. Browse and add items.
                            </p>
                        )}
                    </div>
                </ScrollArea>

                <Separator />

                {/* Title & description form */}
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <label
                            htmlFor="pr-title"
                            className="text-sm font-medium"
                        >
                            Title
                        </label>
                        <Input
                            id="pr-title"
                            placeholder="Describe your changes…"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            maxLength={300}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label
                            htmlFor="pr-desc"
                            className="text-sm font-medium"
                        >
                            Description{" "}
                            <span className="text-muted-foreground">
                                (optional)
                            </span>
                        </label>
                        <Textarea
                            id="pr-desc"
                            placeholder="Add any additional context…"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            maxLength={1000}
                            rows={3}
                        />
                    </div>
                </div>

                <SheetFooter className="flex-col gap-2 sm:flex-col">
                    <Button
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="w-full gap-2"
                    >
                        {submitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Send className="h-4 w-4" />
                        )}
                        Submit Pull Request
                    </Button>
                    <Button
                        variant="ghost"
                        className="w-full text-destructive hover:text-destructive"
                        onClick={handleClear}
                        disabled={operations.length === 0}
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Discard All
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

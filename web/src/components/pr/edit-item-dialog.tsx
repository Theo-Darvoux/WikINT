"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FilePenLine, FolderPen, Plus, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useStagingStore, type Operation } from "@/lib/staging-store";
import { submitDirectOperations } from "@/lib/pr-client";
import { TagInput } from "@/components/ui/tag-input";
import { useBrowseRefreshStore } from "@/lib/stores";

interface EditItemDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    target: {
        type: "material" | "directory";
        id: string;
        data: Record<string, unknown>;
    };
}

export function EditItemDialog({
    open,
    onOpenChange,
    target,
}: EditItemDialogProps) {
    const addOperation = useStagingStore((s) => s.addOperation);
    const isMaterial = target.type === "material";

    // Pre-fill from current values
    const currentTitle = String(
        isMaterial ? target.data.title ?? "" : target.data.name ?? "",
    );
    const currentDescription = String(target.data.description ?? "");
    const rawTags = (target.data.tags ?? []) as unknown[];
    const currentTags = Array.isArray(rawTags)
        ? rawTags.map(String).filter(Boolean)
        : [];

    const [title, setTitle] = useState(currentTitle);
    const [description, setDescription] = useState(currentDescription);
    const [tags, setTags] = useState<string[]>(currentTags);
    const [submitting, setSubmitting] = useState(false);
    const triggerBrowseRefresh = useBrowseRefreshStore((s) => s.triggerBrowseRefresh);

    // Track whether anything actually changed
    const hasTagsChanged = () => {
        if (tags.length !== currentTags.length) return true;
        return tags.some((t, i) => t !== currentTags[i]);
    };

    const hasChanges =
        title !== currentTitle ||
        description !== currentDescription ||
        hasTagsChanged();

    const canSubmit = hasChanges && title.trim().length > 0 && !submitting;
    const isDraftTarget = target.id.startsWith("$");

    const buildOp = (): Operation => {
        if (isMaterial) {
            return {
                op: "edit_material",
                material_id: target.id,
                ...(title !== currentTitle ? { title: title.trim() } : {}),
                ...(description !== currentDescription
                    ? { description: description.trim() || null }
                    : {}),
                ...(hasTagsChanged() ? { tags } : {}),
            };
        } else {
            return {
                op: "edit_directory",
                directory_id: target.id,
                ...(title !== currentTitle ? { name: title.trim() } : {}),
                ...(description !== currentDescription
                    ? { description: description.trim() || null }
                    : {}),
                ...(hasTagsChanged() ? { tags } : {}),
            };
        }
    };

    const handleDraft = () => {
        if (!canSubmit) return;
        addOperation(buildOp());
        toast.success(`Added to draft: "${title.trim()}"`);
        onOpenChange(false);
    };

    const handleDirectSubmit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        const result = await submitDirectOperations([buildOp()]);
        setSubmitting(false);
        onOpenChange(false);
        if (result?.status === "approved") {
            triggerBrowseRefresh();
        }
    };

    // Reset fields when dialog opens with new target
    const handleOpenChange = (next: boolean) => {
        if (next) {
            setTitle(currentTitle);
            setDescription(currentDescription);
            setTags(currentTags);
        }
        onOpenChange(next);
    };

    const Icon = isMaterial ? FilePenLine : FolderPen;
    const typeLabel = isMaterial ? "a document" : "a folder";

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Icon className="h-5 w-5 text-blue-600" />
                        Edit {typeLabel}
                    </DialogTitle>
                    <DialogDescription>
                        Editing{" "}
                        <span className="font-medium text-foreground">
                            {currentTitle}
                        </span>
                        . You can submit the contribution directly or add it to your draft.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <label
                            htmlFor="edit-title"
                            className="text-sm font-medium"
                        >
                            {isMaterial ? "Title" : "Name"}
                        </label>
                        <Input
                            id="edit-title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            maxLength={100}
                            disabled={submitting}
                            autoFocus
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label
                            htmlFor="edit-desc"
                            className="text-sm font-medium"
                        >
                            Description{" "}
                            <span className="text-muted-foreground">
                                (optional)
                            </span>
                        </label>
                        <Textarea
                            id="edit-desc"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            maxLength={1000}
                            disabled={submitting}
                            rows={3}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label
                            htmlFor="edit-tags"
                            className="text-sm font-medium"
                        >
                            Tags
                        </label>
                        <TagInput
                            key={target.id}
                            tags={tags}
                            onChange={setTags}
                            placeholder="math, algebra..."
                        />
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0 mt-2">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={submitting}
                        className="sm:mr-auto"
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="outline"
                        onClick={handleDraft}
                        disabled={!canSubmit}
                        className="gap-2 border-dashed border-primary/50 text-primary hover:bg-primary/5"
                    >
                        <Plus className="h-4 w-4" />
                        Add to draft
                    </Button>
                    {!isDraftTarget && (
                        <Button
                            onClick={handleDirectSubmit}
                            disabled={!canSubmit}
                            className="gap-2"
                        >
                            {submitting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Send className="h-4 w-4" />
                            )}
                            Submit directly
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

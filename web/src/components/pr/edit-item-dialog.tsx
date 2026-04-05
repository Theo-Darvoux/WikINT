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
import { FilePenLine, FolderPen } from "lucide-react";
import { toast } from "sonner";
import { useStagingStore } from "@/lib/staging-store";
import { TagInput } from "@/components/ui/tag-input";

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

    // Track whether anything actually changed
    const hasTagsChanged = () => {
        if (tags.length !== currentTags.length) return true;
        // Compare sorted to be order-agnostic for "has changes" check if preferred,
        // but simple sequence check is safer for PR purposes.
        return tags.some((t, i) => t !== currentTags[i]);
    };

    const hasChanges =
        title !== currentTitle ||
        description !== currentDescription ||
        hasTagsChanged();

    const canSubmit = hasChanges && title.trim().length > 0;

    const handleStage = () => {
        if (!canSubmit) return;

        if (isMaterial) {
            addOperation({
                op: "edit_material",
                material_id: target.id,
                ...(title !== currentTitle ? { title: title.trim() } : {}),
                ...(description !== currentDescription
                    ? { description: description.trim() || null }
                    : {}),
                ...(hasTagsChanged() ? { tags } : {}),
            });
            toast.success(`Edit to "${title.trim()}" staged`);
        } else {
            addOperation({
                op: "edit_directory",
                directory_id: target.id,
                ...(title !== currentTitle ? { name: title.trim() } : {}),
                ...(description !== currentDescription
                    ? { description: description.trim() || null }
                    : {}),
                ...(hasTagsChanged() ? { tags } : {}),
            });
            toast.success(`Edit to folder "${title.trim()}" staged`);
        }

        onOpenChange(false);
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
    const typeLabel = isMaterial ? "Material" : "Folder";

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Icon className="h-5 w-5 text-blue-600" />
                        Edit {typeLabel}
                    </DialogTitle>
                    <DialogDescription>
                        Edit{" "}
                        <span className="font-medium text-foreground">
                            {currentTitle}
                        </span>
                        . Changes will be staged as a pending PR operation.
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
                            placeholder="math, algebra, lecture..."
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleStage}
                        disabled={!canSubmit}
                        className="gap-2"
                    >
                        <Icon className="h-4 w-4" />
                        Stage Edit
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

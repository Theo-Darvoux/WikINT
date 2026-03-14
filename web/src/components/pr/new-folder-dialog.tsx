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
import { FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { useStagingStore } from "@/lib/staging-store";

interface NewFolderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** UUID of the parent directory (null for root) */
    parentId: string | null;
    parentName?: string;
}

export function NewFolderDialog({
    open,
    onOpenChange,
    parentId,
    parentName,
}: NewFolderDialogProps) {
    const addOperation = useStagingStore((s) => s.addOperation);
    const nextTempId = useStagingStore((s) => s.nextTempId);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");

    const canSubmit = name.trim().length >= 1;

    const handleStage = () => {
        if (!canSubmit) return;

        const tempId = nextTempId("dir");

        addOperation({
            op: "create_directory",
            temp_id: tempId,
            parent_id: parentId,
            name: name.trim(),
            description: description.trim() || undefined,
        });

        toast.success(`Folder "${name.trim()}" staged for creation`);
        setName("");
        setDescription("");
        onOpenChange(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey && canSubmit) {
            e.preventDefault();
            handleStage();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FolderPlus className="h-5 w-5 text-green-600" />
                        New Folder
                    </DialogTitle>
                    <DialogDescription>
                        Create a new folder
                        {parentName ? (
                            <>
                                {" "}
                                in{" "}
                                <span className="font-medium text-foreground">
                                    {parentName}
                                </span>
                            </>
                        ) : (
                            " at root level"
                        )}
                        . This will be staged as a pending change.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2" onKeyDown={handleKeyDown}>
                    <div className="space-y-1.5">
                        <label
                            htmlFor="folder-name"
                            className="text-sm font-medium"
                        >
                            Folder Name
                        </label>
                        <Input
                            id="folder-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Week 5"
                            maxLength={100}
                            autoFocus
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label
                            htmlFor="folder-desc"
                            className="text-sm font-medium"
                        >
                            Description{" "}
                            <span className="text-muted-foreground">
                                (optional)
                            </span>
                        </label>
                        <Textarea
                            id="folder-desc"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What's in this folder?"
                            maxLength={500}
                            rows={2}
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
                        <FolderPlus className="h-4 w-4" />
                        Stage Folder
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

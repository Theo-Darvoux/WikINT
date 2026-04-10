"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { FolderPlus, Plus, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useStagingStore, type Operation } from "@/lib/staging-store";
import { TagInput } from "@/components/ui/tag-input";
import { submitDirectOperations } from "@/lib/pr-client";

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
    const router = useRouter();
    const addOperation = useStagingStore((s) => s.addOperation);
    const nextTempId = useStagingStore((s) => s.nextTempId);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);

    const canSubmit = name.trim().length >= 1 && !submitting;
    const isDraftParent = parentId?.startsWith("$") ?? false;

    const buildOp = (): Operation => {
        const tempId = nextTempId("dir");
        return {
            op: "create_directory",
            temp_id: tempId,
            parent_id: parentId,
            name: name.trim(),
            description: description.trim() || undefined,
            tags: tags.length > 0 ? tags : undefined,
        };
    };

    const handleDraft = () => {
        if (!canSubmit) return;
        addOperation(buildOp());
        toast.success(`Ajouté au brouillon : Dossier "${name.trim()}"`);
        setName("");
        setDescription("");
        setTags([]);
        onOpenChange(false);
    };

    const handleDirectSubmit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        const result = await submitDirectOperations([buildOp()]);
        setSubmitting(false);
        setName("");
        setDescription("");
        setTags([]);
        onOpenChange(false);
        if (result?.status === "approved") {
            router.refresh();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey && canSubmit) {
            e.preventDefault();
            if (isDraftParent) {
                handleDraft();
            } else {
                handleDirectSubmit();
            }
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FolderPlus className="h-5 w-5 text-green-600" />
                        Nouveau dossier
                    </DialogTitle>
                    <DialogDescription>
                        Création d'un dossier
                        {parentName ? (
                            <>
                                {" "}
                                dans{" "}
                                <span className="font-medium text-foreground">
                                    {parentName}
                                </span>
                            </>
                        ) : (
                            " à la racine"
                        )}
                        .
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2" onKeyDown={handleKeyDown}>
                    <div className="space-y-1.5">
                        <label
                            htmlFor="folder-name"
                            className="text-sm font-medium"
                        >
                            Nom du dossier
                        </label>
                        <Input
                            id="folder-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="ex: Semaine 5"
                            maxLength={100}
                            disabled={submitting}
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
                                (optionnel)
                            </span>
                        </label>
                        <Textarea
                            id="folder-desc"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Que contient ce dossier ?"
                            maxLength={500}
                            disabled={submitting}
                            rows={2}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Tags</label>
                        <TagInput
                            tags={tags}
                            onChange={setTags}
                            placeholder="math, analyse..."
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
                        Annuler
                    </Button>
                    <Button
                        variant="outline"
                        onClick={handleDraft}
                        disabled={!canSubmit}
                        className="gap-2 border-dashed border-primary/50 text-primary hover:bg-primary/5"
                    >
                        <Plus className="h-4 w-4" />
                        Brouillon
                    </Button>
                    {!isDraftParent && (
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
                            Créer direct
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

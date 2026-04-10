"use client";

import { useEffect, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/ui/tag-input";
import { useStagingStore, unwrapOp } from "@/lib/staging-store";
import type { Operation, CreateMaterialOp, EditMaterialOp, CreateDirectoryOp, EditDirectoryOp } from "@/lib/staging-store";

interface StagedItemEditDialogProps {
    /** The index in the staging operations array, or null if closed */
    index: number | null;
    onClose: () => void;
}

export function StagedItemEditDialog({ index, onClose }: StagedItemEditDialogProps) {
    const operations = useStagingStore((s) => s.operations);
    const updateOperation = useStagingStore((s) => s.updateOperation);

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    
    // Safety check against out of bounds index
    const staged = index !== null ? operations[index] : null;
    const op = staged ? unwrapOp(staged) : null;

    useEffect(() => {
        if (!op) return;

        if (op.op === "create_material") {
            setTitle(op.title);
            setDescription(op.description || "");
            setTags(op.tags || []);
        } else if (op.op === "create_directory") {
            setTitle(op.name);
            setDescription(op.description || "");
            setTags(op.tags || []);
        } else if (op.op === "edit_material") {
            setTitle(op.title || "");
            setDescription(op.description || "");
            setTags(op.tags || []);
        } else if (op.op === "edit_directory") {
            setTitle(op.name || "");
            setDescription(op.description || "");
            setTags(op.tags || []);
        } else {
            // For other op types (move/delete), no editable fields
            setTitle("");
            setDescription("");
            setTags([]);
        }
    }, [op]);

    const handleSave = () => {
        if (index === null || !op) return;

        const newOp = { ...op } as Record<string, unknown>;

        if (op.op === "create_material" || op.op === "edit_material") {
            newOp.title = title.trim() || undefined; // If edit_material title might be empty
            newOp.description = description.trim() || null;
            newOp.tags = tags;
            // create_material requires title, so guarantee one
            if (op.op === "create_material" && !newOp.title) {
                newOp.title = "Sans Titre";
            }
        } else if (op.op === "create_directory" || op.op === "edit_directory") {
            newOp.name = title.trim() || undefined;
            newOp.description = description.trim() || null;
            newOp.tags = tags;
            // create_directory requires name
            if (op.op === "create_directory" && !newOp.name) {
                newOp.name = "Nouveau Dossier";
            }
        }

        updateOperation(index, newOp as unknown as Operation);
        onClose();
    };

    // If modal tries to open but we are tracking a non-editable op type, close it
    const isEditable = op?.op === "create_material" || op?.op === "edit_material" || op?.op === "create_directory" || op?.op === "edit_directory";

    return (
        <Dialog open={index !== null && isEditable} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Éditer l'élément</DialogTitle>
                    <DialogDescription>
                        Modifiez les informations de cette contribution avant de l'ajouter définitivement.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Nom / Titre</label>
                        <Input
                            placeholder="Titre du fichier ou dossier"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Description</label>
                        <Textarea
                            placeholder="Description optionnelle..."
                            className="resize-none"
                            rows={3}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium">Tags</label>
                        <TagInput
                            placeholder="Ajouter un tag..."
                            tags={tags}
                            onChange={(newTags) => setTags(newTags)}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuler</Button>
                    <Button onClick={handleSave}>Enregistrer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

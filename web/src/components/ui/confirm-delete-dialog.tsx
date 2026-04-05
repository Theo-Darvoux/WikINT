"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDeleteDialogProps {
    onConfirm: () => void | Promise<void>;
    title?: string;
    description?: string;
    trigger?: React.ReactNode;
}

export function ConfirmDeleteDialog({
    onConfirm,
    title = "Delete item",
    description = "Are you sure you want to delete this item? This action cannot be undone.",
    trigger
}: ConfirmDeleteDialogProps) {
    const [open, setOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleConfirm = async () => {
        try {
            setIsDeleting(true);
            await onConfirm();
        } finally {
            setIsDeleting(false);
            setOpen(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <button className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-destructive">
                        <Trash2 className="h-3 w-3" />
                        Delete
                    </button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isDeleting}>
                        Cancel
                    </Button>
                    <Button variant="destructive" onClick={handleConfirm} disabled={isDeleting}>
                        {isDeleting ? "Deleting..." : "Delete"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

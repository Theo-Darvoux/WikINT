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
import { useTranslations } from "next-intl";

interface ConfirmDeleteDialogProps {
    onConfirm: () => void | Promise<void>;
    title?: string;
    description?: string;
    trigger?: React.ReactNode;
}

export function ConfirmDeleteDialog({
    onConfirm,
    title,
    description,
    trigger
}: ConfirmDeleteDialogProps) {
    const t = useTranslations("Common");
    const [open, setOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const displayTitle = title || t("deleteItemTitle");
    const displayDescription = description || t("deleteItemDescription");

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
                        {t("delete")}
                    </button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{displayTitle}</DialogTitle>
                    <DialogDescription>{displayDescription}</DialogDescription>
                </DialogHeader>
                <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isDeleting}>
                        {t("cancel")}
                    </Button>
                    <Button variant="destructive" onClick={handleConfirm} disabled={isDeleting}>
                        {isDeleting ? t("deleting") : t("delete")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

"use client";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { create } from "zustand";

interface ConfirmState {
    open: boolean;
    title: string;
    description: string;
    onConfirm: (() => void) | null;
    show: (title: string, description: string, onConfirm: () => void) => void;
    close: () => void;
}

export const useConfirmDialog = create<ConfirmState>((set) => ({
    open: false,
    title: "",
    description: "",
    onConfirm: null,
    show: (title, description, onConfirm) =>
        set({ open: true, title, description, onConfirm }),
    close: () => set({ open: false, onConfirm: null }),
}));

export function ConfirmDialog() {
    const { open, title, description, onConfirm, close } = useConfirmDialog();

    return (
        <Dialog open={open} onOpenChange={(o) => !o && close()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={close}>
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={() => {
                            onConfirm?.();
                            close();
                        }}
                    >
                        Confirm
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

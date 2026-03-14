"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

const REASONS = [
    { value: "inappropriate", label: "Inappropriate content" },
    { value: "copyright", label: "Copyright violation" },
    { value: "spam", label: "Spam" },
    { value: "incorrect", label: "Incorrect information" },
    { value: "other", label: "Other" },
] as const;

interface FlagButtonProps {
    targetType: "material" | "annotation" | "pull_request" | "comment" | "pr_comment";
    targetId: string;
    variant?: "ghost" | "outline" | "secondary";
    size?: "sm" | "default" | "icon";
    className?: string;
    iconClassName?: string;
    hideText?: boolean;
}

export function FlagButton({ targetType, targetId, variant = "ghost", size = "sm", className, iconClassName = "h-3.5 w-3.5", hideText = false }: FlagButtonProps) {
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [description, setDescription] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!reason || submitting) return;
        setSubmitting(true);
        try {
            await apiFetch("/flags", {
                method: "POST",
                body: JSON.stringify({
                    target_type: targetType,
                    target_id: targetId,
                    reason,
                    description: description.trim() || undefined,
                }),
            });
            toast.success("Report submitted");
            setOpen(false);
            setReason("");
            setDescription("");
        } catch {
            toast.error("Failed to submit report");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            <Button
                variant={variant}
                size={size}
                className={className}
                onClick={() => setOpen(true)}
                title="Report"
            >
                <Flag className={iconClassName} />
                {size !== "icon" && !hideText && <span className="ml-1">Report</span>}
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Report content</DialogTitle>
                        <DialogDescription>
                            Help us keep the platform safe by reporting inappropriate content.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="flag-reason">Reason</Label>
                            <Select value={reason} onValueChange={setReason}>
                                <SelectTrigger id="flag-reason">
                                    <SelectValue placeholder="Select a reason" />
                                </SelectTrigger>
                                <SelectContent>
                                    {REASONS.map((r) => (
                                        <SelectItem key={r.value} value={r.value}>
                                            {r.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="flag-description">Description (optional)</Label>
                            <Textarea
                                id="flag-description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value.slice(0, 500))}
                                placeholder="Provide additional details..."
                                className="min-h-[80px]"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleSubmit}
                            disabled={!reason || submitting}
                        >
                            {submitting ? "Submitting..." : "Submit report"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
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
import { useIsMobile } from "@/hooks/use-media-query";
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer";

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
    const isMobile = useIsMobile();

    const button = (
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
    );

    if (isMobile) {
        return (
            <>
                {button}
                <Drawer open={open} onOpenChange={setOpen}>
                    <DrawerContent>
                        <FlagForm
                            targetType={targetType}
                            targetId={targetId}
                            onClose={() => setOpen(false)}
                            isDrawer
                        />
                    </DrawerContent>
                </Drawer>
            </>
        );
    }

    return (
        <>
            {button}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <FlagForm
                        targetType={targetType}
                        targetId={targetId}
                        onClose={() => setOpen(false)}
                    />
                </DialogContent>
            </Dialog>
        </>
    );
}

interface FlagFormProps {
    targetType: FlagButtonProps["targetType"];
    targetId: string;
    onClose: () => void;
    isDrawer?: boolean;
}

function FlagForm({ targetType, targetId, onClose, isDrawer }: FlagFormProps) {
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
            onClose();
        } catch {
            toast.error("Failed to submit report");
        } finally {
            setSubmitting(false);
        }
    };

    const Header = isDrawer ? DrawerHeader : DialogHeader;
    const Title = isDrawer ? DrawerTitle : DialogTitle;
    const Description = isDrawer ? DrawerDescription : DialogDescription;
    const Footer = isDrawer ? DrawerFooter : DialogFooter;

    return (
        <>
            <Header>
                <Title>Report content</Title>
                <Description>
                    Help us keep the platform safe by reporting inappropriate content.
                </Description>
            </Header>

            <div className="space-y-4 px-4 py-2 sm:px-0 overflow-y-auto max-h-[50vh] sm:max-h-none">
                <div className="space-y-2">
                    <Label htmlFor="flag-reason">Reason</Label>
                    <Select value={reason} onValueChange={setReason}>
                        <SelectTrigger id="flag-reason">
                            <SelectValue placeholder="Select a reason" />
                        </SelectTrigger>
                        <SelectContent className="z-[80]">
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
                        className="min-h-[100px]"
                    />
                </div>
            </div>

            <Footer className={isDrawer ? "mb-6" : ""}>
                <Button variant="outline" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    variant="destructive"
                    onClick={handleSubmit}
                    disabled={!reason || submitting}
                >
                    {submitting ? "Submitting..." : "Submit report"}
                </Button>
            </Footer>
        </>
    );
}


"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { PRFileUpload } from "./pr-file-upload";

type PRType = "create_material" | "edit_material" | "delete_material" | "create_directory" | "edit_directory" | "delete_directory" | "move_item";

export function PRCreateWizard() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Form state
    const [step, setStep] = useState(1);
    const [prType, setPrType] = useState<PRType>((searchParams?.get("prType") as PRType) || "create_material");
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [targetId] = useState(searchParams?.get("targetId") || ""); // Directory ID or Material ID
    const [itemName, setItemName] = useState(""); // For material title / dir name
    const [itemDescription, setItemDescription] = useState("");
    const [itemType] = useState("document");
    const [tags, setTags] = useState("");

    const [fileKey, setFileKey] = useState<string | null>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [fileSize, setFileSize] = useState<number | null>(null);
    const [fileMimeType, setFileMimeType] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Validation errors
    const [errors, setErrors] = useState<Record<string, string>>({});

    const requiresUpload = ["create_material", "edit_material"].includes(prType);

    const validateStep1 = () => {
        const newErrors: Record<string, string> = {};
        if (!title.trim()) newErrors.title = "A title is required.";
        else if (title.length < 3) newErrors.title = "Title must be at least 3 characters.";
        else if (title.length > 100) newErrors.title = "Title max length is 100 characters.";

        if (description && description.length > 1000) newErrors.description = "Description max length is 1000 characters.";

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const validateStep2 = () => {
        const newErrors: Record<string, string> = {};

        if (["create_material", "create_directory"].includes(prType)) {
            if (!itemName.trim()) newErrors.itemName = "Name/Title is required.";
            else if (itemName.length > 100) newErrors.itemName = "Max length is 100 characters.";
        }

        if (["edit_material", "edit_directory"].includes(prType)) {
            if (itemName && itemName.length > 100) newErrors.itemName = "Max length is 100 characters.";
            // Require at least one field to change if not uploading a new file (file upload happens in step 3 so we validate what we can here)
            if (!itemName.trim() && !itemDescription.trim() && prType === "edit_directory") {
                newErrors.general = "Please provide at least one attribute to update.";
            }
        }

        if (tags && tags.length > 200) newErrors.tags = "Tags string max length is 200 characters.";

        if (["edit_material", "delete_material", "edit_directory", "delete_directory"].includes(prType)) {
            if (!targetId) newErrors.general = "A target item must be selected to perform this action.";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            const payload: Record<string, unknown> = { pr_type: prType };

            if (prType === "create_material") {
                payload.directory_id = targetId;
                payload.title = itemName;
                payload.description = itemDescription;
                payload.type = itemType;
                payload.tags = tags.split(",").map(t => t.trim()).filter(Boolean);
                if (fileKey) {
                    payload.file_key = fileKey;
                    payload.file_name = fileName;
                    payload.file_size = fileSize;
                    payload.file_mime_type = fileMimeType;
                }
            } else if (prType === "edit_material") {
                payload.material_id = targetId;
                if (itemName) payload.title = itemName;
                if (itemDescription) payload.description = itemDescription;
                if (fileKey) {
                    payload.file_key = fileKey;
                    payload.file_name = fileName;
                    payload.file_size = fileSize;
                    payload.file_mime_type = fileMimeType;
                }
            } else if (prType === "create_directory") {
                payload.parent_id = targetId || null;
                payload.name = itemName;
                payload.description = itemDescription;
            } else if (prType === "edit_directory") {
                payload.directory_id = targetId;
                if (itemName) payload.name = itemName;
                if (itemDescription) payload.description = itemDescription;
            } else if (prType === "delete_material") {
                payload.material_id = targetId;
            } else if (prType === "delete_directory") {
                payload.directory_id = targetId;
            }

            const res = await apiFetch<{ id: string }>("/pull-requests", {
                method: "POST",
                body: JSON.stringify({
                    type: prType,
                    title,
                    description,
                    payload
                })
            });
            router.push(`/pull-requests/${res.id}`);
        } catch (e) {
            console.error(e);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            {step === 1 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                    <h2 className="text-xl font-semibold">Step 1: What do you want to do?</h2>
                    <Select value={prType} onValueChange={(val) => setPrType(val as PRType)}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select PR Type" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="create_material">Upload New Material</SelectItem>
                            <SelectItem value="edit_material">Update Material</SelectItem>
                            <SelectItem value="delete_material">Delete Material</SelectItem>
                            <SelectItem value="create_directory">Create Directory</SelectItem>
                            <SelectItem value="edit_directory">Edit Directory</SelectItem>
                            <SelectItem value="delete_directory">Delete Directory</SelectItem>
                        </SelectContent>
                    </Select>

                    <div className="space-y-2 pt-4">
                        <label className="text-sm font-medium">PR Title (Summary of changes)</label>
                        <Input value={title} onChange={e => { setTitle(e.target.value); setErrors({ ...errors, title: "" }) }} placeholder="e.g., Add lecture 5 slides" />
                        {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">PR Description</label>
                        <Textarea value={description} onChange={e => { setDescription(e.target.value); setErrors({ ...errors, description: "" }) }} placeholder="Why is this change necessary?" rows={3} />
                        {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
                    </div>

                    <Button className="w-full" onClick={() => validateStep1() && setStep(2)}>Next</Button>
                </div>
            )}

            {step === 2 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                    <h2 className="text-xl font-semibold">Step 2: Details</h2>

                    {errors.general && <p className="text-sm text-destructive font-semibold p-2 bg-destructive/10 rounded">{errors.general}</p>}

                    {["create_material", "create_directory", "edit_material", "edit_directory"].includes(prType) && (
                        <>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Name / Title</label>
                                <Input value={itemName} onChange={e => { setItemName(e.target.value); setErrors({ ...errors, itemName: "", general: "" }) }} placeholder="Item title" />
                                {errors.itemName && <p className="text-sm text-destructive">{errors.itemName}</p>}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Description</label>
                                <Textarea value={itemDescription} onChange={e => { setItemDescription(e.target.value); setErrors({ ...errors, general: "" }) }} rows={2} />
                            </div>
                        </>
                    )}

                    {prType === "create_material" && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Comma-separated Tags</label>
                            <Input value={tags} onChange={e => { setTags(e.target.value); setErrors({ ...errors, tags: "" }) }} placeholder="math, physics..." />
                            {errors.tags && <p className="text-sm text-destructive">{errors.tags}</p>}
                        </div>
                    )}

                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                        <Button className="flex-1" onClick={() => validateStep2() && setStep(requiresUpload ? 3 : 4)}>Next</Button>
                    </div>
                </div>
            )}

            {step === 3 && requiresUpload && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                    <h2 className="text-xl font-semibold">Step 3: Upload File</h2>
                    <PRFileUpload onUploadComplete={({ fileKey: key, fileName: name, fileSize: size, mimeType: mime }) => { setFileKey(key); setFileName(name); setFileSize(size); setFileMimeType(mime); setStep(4); }} />
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                        <Button variant="secondary" onClick={() => setStep(4)}>Skip Upload (Metadata only)</Button>
                    </div>
                </div>
            )}

            {step === 4 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                    <h2 className="text-xl font-semibold">Review & Submit</h2>
                    <div className="p-4 bg-muted/30 border rounded-lg space-y-2 text-sm">
                        <p><strong>Action:</strong> {prType}</p>
                        <p><strong>PR Title:</strong> {title}</p>
                        <p><strong>Target ID:</strong> {targetId || "Root"}</p>
                        {itemName && <p><strong>Item Name:</strong> {itemName}</p>}
                        {fileKey && <p><strong>File Attached:</strong> Yes</p>}
                    </div>

                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setStep(requiresUpload ? 3 : 2)}>Back</Button>
                        <Button className="flex-1" disabled={submitting} onClick={handleSubmit}>
                            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            Submit Pull Request
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

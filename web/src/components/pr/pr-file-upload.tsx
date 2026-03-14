"use client";

import { useState, useRef } from "react";
import { UploadCloud, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GB

interface UploadRequestOut {
    upload_url: string;
    file_key: string;
    mime_type: string;
}

interface UploadCompleteOut {
    file_key: string;
    size: number;
    mime_type: string;
}

interface UploadResult {
    fileKey: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
}

export function PRFileUpload({ onUploadComplete }: { onUploadComplete: (result: UploadResult) => void }) {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "uploading" | "scanning" | "success" | "error">("idle");
    const [progress, setProgress] = useState(0);
    const [errorMsg, setErrorMsg] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const selected = e.target.files[0];
            if (selected.size > MAX_FILE_SIZE) {
                setStatus("error");
                setErrorMsg("File exceeds the 1 GB size limit");
                return;
            }
            setFile(selected);
            setStatus("idle");
            setErrorMsg("");
        }
    };

    const handleUpload = async () => {
        if (!file) return;
        setStatus("uploading");
        setProgress(0);
        setErrorMsg("");

        try {
            // 1. Request presigned URL
            const { upload_url, file_key, mime_type } = await apiFetch<UploadRequestOut>("/upload/request-url", {
                method: "POST",
                body: JSON.stringify({
                    filename: file.name,
                    size: file.size,
                    mime_type: file.type || "application/octet-stream",
                })
            });

            // 2. PUT to presigned URL
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", upload_url, true);
            xhr.setRequestHeader("Content-Type", mime_type);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    setProgress(Math.round((e.loaded / e.total) * 100));
                }
            };

            await new Promise<void>((resolve, reject) => {
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) resolve();
                    else reject(new Error("Upload failed"));
                };
                xhr.onerror = () => reject(new Error("Network error"));
                xhr.send(file);
            });

            // 3. Complete & scan
            setStatus("scanning");
            const result = await apiFetch<UploadCompleteOut>("/upload/complete", {
                method: "POST",
                body: JSON.stringify({ file_key })
            });

            setStatus("success");
            onUploadComplete({
                fileKey: result.file_key,
                fileName: file.name,
                fileSize: result.size,
                mimeType: result.mime_type,
            });

        } catch (err: unknown) {
            setStatus("error");
            setErrorMsg((err as Error).message || "Failed to upload file");
        }
    };

    return (
        <div
            className={`border-2 border-dashed rounded-xl p-8 text-center space-y-4 transition-colors ${status === "idle" ? "cursor-pointer hover:bg-muted/10" : ""}`}
            onClick={() => {
                if (status === "idle") {
                    fileInputRef.current?.click();
                }
            }}
        >
            {status === "idle" && (
                <>
                    <UploadCloud className="w-10 h-10 mx-auto text-muted-foreground" />
                    <div>
                        <Input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            className="hidden"
                        />
                        {!file && (
                            <p className="text-sm font-medium text-muted-foreground mt-2">
                                Click to select a file
                            </p>
                        )}
                        {file && (
                            <p className="text-sm font-medium text-foreground mt-2">
                                Selected: {file.name}
                            </p>
                        )}
                    </div>
                    {file && (
                        <Button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleUpload();
                            }}
                        >
                            Start Upload
                        </Button>
                    )}
                </>
            )}

            {status === "uploading" && (
                <div className="space-y-3 max-w-xs mx-auto">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                    <div className="text-sm font-medium">Uploading... {progress}%</div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
                    </div>
                </div>
            )}

            {status === "scanning" && (
                <div className="space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                    <div className="text-sm font-medium">Scanning for viruses...</div>
                    <div className="text-xs text-muted-foreground">This may take a minute for large files.</div>
                </div>
            )}

            {status === "error" && (
                <div className="space-y-3">
                    <AlertCircle className="w-10 h-10 mx-auto text-red-500" />
                    <div className="text-sm font-bold text-red-500">Upload Failed</div>
                    <div className="text-xs text-muted-foreground">{errorMsg}</div>
                    <Button variant="outline" onClick={() => setStatus("idle")}>Try Again</Button>
                </div>
            )}

            {status === "success" && (
                <div className="space-y-3">
                    <CheckCircle2 className="w-10 h-10 mx-auto text-green-500" />
                    <div className="text-sm font-bold text-green-500">Upload & Scan Complete!</div>
                </div>
            )}
        </div>
    );
}

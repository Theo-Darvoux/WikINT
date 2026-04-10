"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { UploadCloud, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_MB, ACCEPTED_FILE_TYPES, formatFileSize } from "@/lib/file-utils";
import { uploadFile, logicalFileSize, type UploadResult } from "@/lib/upload-client";
import { ApiError } from "@/lib/api-client";

interface UploadCompleteResult {
    fileKey: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
}

// Machine-readable code → friendly message
const ERROR_CODE_MESSAGES: Record<string, string> = {
    ERR_FILE_TOO_LARGE: `File exceeds the size limit.`,
    ERR_TYPE_NOT_ALLOWED: "This file type is not supported.",
    ERR_MIME_MISMATCH: "File extension doesn't match its actual content.",
    ERR_SVG_UNSAFE: "This SVG contains unsafe content and cannot be uploaded.",
    ERR_SVG_MALFORMED: "This SVG is malformed and cannot be processed.",
    ERR_MALWARE_DETECTED: "This file was flagged as malicious and cannot be uploaded.",
    ERR_SCAN_UNAVAILABLE: "File scanning is temporarily unavailable. Please try again.",
    ERR_QUOTA_EXCEEDED: "Upload limit reached. Wait for current uploads to complete, then try again.",
    ERR_INTENT_EXPIRED: "Upload session expired. Please try again.",
};

function friendlyError(raw: string, code?: string): string {
    if (code && ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code];
    // Fallback: substring match for legacy plain-text errors
    for (const [key, msg] of Object.entries(ERROR_CODE_MESSAGES)) {
        if (raw.includes(key)) return msg;
    }
    return raw;
}

function extractErrorCode(err: unknown): string | undefined {
    if (err instanceof ApiError) {
        const detail = err.message;
        try {
            const parsed = JSON.parse(detail);
            return parsed.code;
        } catch {
            return undefined;
        }
    }
    return undefined;
}

export function PRFileUpload({
    onUploadComplete,
}: {
    onUploadComplete: (result: UploadCompleteResult) => void;
}) {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
    const [progress, setProgress] = useState(0);
    const [processingStatus, setProcessingStatus] = useState("Processing…");
    const [stageIndex, setStageIndex] = useState<number | undefined>(undefined);
    const [stageTotal, setStageTotal] = useState<number | undefined>(undefined);
    const [errorMsg, setErrorMsg] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
    const [elapsedSec, setElapsedSec] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const startTimeRef = useRef<number>(0);

    // Elapsed-time counter while server-side processing (progress ≥ 80)
    useEffect(() => {
        if (status !== "uploading" || progress < 80) {
            setElapsedSec(0);
            return;
        }
        startTimeRef.current = Date.now();
        const id = setInterval(() => {
            setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }, 1000);
        return () => clearInterval(id);
    }, [status, progress]);

    const selectFile = useCallback((selected: File) => {
        if (selected.size > MAX_FILE_SIZE) {
            setStatus("error");
            setErrorMsg(`File exceeds the ${MAX_FILE_SIZE_MB} MiB size limit`);
            return;
        }
        setFile(selected);
        setStatus("idle");
        setErrorMsg("");
        setUploadResult(null);
    }, []);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            selectFile(e.target.files[0]);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (e.dataTransfer.files.length > 1) {
            toast.warning("Only the first file will be uploaded in single-file mode.");
        }
        const dropped = e.dataTransfer.files[0];
        if (dropped) selectFile(dropped);
    };

    const handleUpload = useCallback(async (fileOverride?: File) => {
        const target = fileOverride ?? file;
        if (!target) return;

        const controller = new AbortController();
        abortRef.current = controller;

        setStatus("uploading");
        setProgress(0);
        setErrorMsg("");
        setProcessingStatus("Preparing…");
        setStageIndex(undefined);
        setStageTotal(undefined);

        try {
            const result = await uploadFile(target, {
                onProgress: setProgress,
                onStatusUpdate: (msg, si, st) => {
                    setProcessingStatus(msg);
                    setStageIndex(si);
                    setStageTotal(st);
                },
                signal: controller.signal,
            });

            setUploadResult(result);
            setStatus("success");
            onUploadComplete({
                fileKey: result.file_key,
                fileName: result.correctedName,
                fileSize: logicalFileSize(result),
                mimeType: result.mime_type,
            });
        } catch (err: unknown) {
            if ((err as Error).message === "Upload cancelled") {
                setStatus("idle");
                return;
            }
            setStatus("error");
            const raw = err instanceof ApiError ? err.message : (err as Error).message || "Upload failed";
            const code = extractErrorCode(err);
            setErrorMsg(friendlyError(raw, code));
        } finally {
            abortRef.current = null;
        }
    }, [file, onUploadComplete]);

    const handleCancel = () => {
        abortRef.current?.abort();
    };

    const handleReset = () => {
        setFile(null);
        setStatus("idle");
        setErrorMsg("");
        setUploadResult(null);
        setProgress(0);
        setStageIndex(undefined);
        setStageTotal(undefined);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    return (
        <div
            className={`border-2 border-dashed rounded-xl p-8 text-center space-y-4 transition-colors ${
                isDragging
                    ? "border-primary bg-primary/5"
                    : status === "idle"
                      ? "cursor-pointer hover:bg-muted/10"
                      : ""
            }`}
            role="region"
            aria-label="File upload drop zone"
            tabIndex={0}
            onClick={() => {
                if (status === "idle") fileInputRef.current?.click();
            }}
            onKeyDown={(e) => {
                if (status === "idle" && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    fileInputRef.current?.click();
                }
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Live region for screen readers */}
            <div aria-live="polite" aria-atomic="true" className="sr-only">
                {status === "uploading" ? (progress >= 80 ? processingStatus : `Uploading ${Math.min(Math.round(progress * 100 / 80), 100)}%`) : ""}
                {status === "success" ? "Upload complete" : ""}
                {status === "error" ? `Upload failed: ${errorMsg}` : ""}
            </div>

            {status === "idle" && (
                <>
                    <UploadCloud className="w-10 h-10 mx-auto text-muted-foreground" aria-hidden="true" />
                    <div>
                        <Input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept={ACCEPTED_FILE_TYPES}
                            className="hidden"
                            aria-label="Select file to upload"
                        />
                        {!file && (
                            <p className="text-sm font-medium text-muted-foreground mt-2">
                                Drag a file here, or press Enter to select.
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
                                void handleUpload();
                            }}
                            aria-label={`Upload ${file.name}`}
                        >
                            Start Upload
                        </Button>
                    )}
                </>
            )}

            {status === "uploading" && (
                <div className="space-y-3 max-w-xs mx-auto">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" aria-hidden="true" />

                    {/* Upload / transfer bar */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Upload</span>
                            <span>{Math.min(Math.round(progress * 100 / 80), 100)}%</span>
                        </div>
                        <div
                            className="h-2 bg-secondary rounded-full overflow-hidden"
                            role="progressbar"
                            aria-valuenow={Math.min(Math.round(progress * 100 / 80), 100)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label="Upload transfer progress"
                        >
                            <div
                                className="h-full bg-primary transition-all duration-300"
                                style={{ width: `${Math.min(Math.round(progress * 100 / 80), 100)}%` }}
                            />
                        </div>
                    </div>

                    {/* Processing bar — appears during server-side stages */}
                    {progress >= 80 && (
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                                <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden="true" />
                                <span className="truncate">{processingStatus || "Processing…"}</span>
                                {stageIndex != null && stageTotal != null && (
                                    <span className="ml-auto shrink-0 font-normal text-muted-foreground text-[10px]">
                                        {stageIndex + 1}/{stageTotal}
                                    </span>
                                )}
                            </div>
                            <div
                                className="h-2 rounded-full overflow-hidden bg-amber-100 dark:bg-amber-950/40"
                                role="progressbar"
                                aria-valuenow={Math.min((progress - 80) * 5, 100)}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label="Processing progress"
                            >
                                <div
                                    className="h-full bg-amber-500 dark:bg-amber-400 animate-pulse transition-all duration-500"
                                    style={{ width: `${Math.min((progress - 80) * 5, 100)}%` }}
                                />
                            </div>
                            {elapsedSec > 0 && (
                                <p className="text-[10px] text-muted-foreground text-center">{elapsedSec}s elapsed</p>
                            )}
                        </div>
                    )}

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancel}
                        aria-label="Cancel upload"
                    >
                        Cancel
                    </Button>
                </div>
            )}

            {status === "error" && (
                <div className="space-y-3">
                    <AlertCircle className="w-10 h-10 mx-auto text-red-500" aria-hidden="true" />
                    <div className="text-sm font-bold text-red-500" role="alert">
                        Upload Failed
                    </div>
                    <div className="text-xs text-muted-foreground">{errorMsg}</div>
                    <div className="flex gap-2 justify-center">
                        {/* Try Again reuses the existing file reference — no re-select needed */}
                        {file && (
                            <Button
                                variant="default"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void handleUpload(file);
                                }}
                            >
                                Try Again
                            </Button>
                        )}
                        <Button variant="outline" onClick={handleReset}>
                            Choose Different File
                        </Button>
                    </div>
                </div>
            )}

            {status === "success" && uploadResult && (
                <div className="space-y-3">
                    <CheckCircle2 className="w-10 h-10 mx-auto text-green-500" aria-hidden="true" />
                    <div className="text-sm font-bold text-green-500">Upload Complete</div>
                    <div className="text-xs text-muted-foreground">
                        {uploadResult.correctedName} &middot; {formatFileSize(uploadResult.size)}
                        {uploadResult.wasCompressed && (
                            <span className="ml-1 italic">
                                (compressed from {formatFileSize(uploadResult.original_size)})
                            </span>
                        )}
                    </div>
                    <Button variant="outline" size="sm" onClick={handleReset}>
                        Upload another file
                    </Button>
                </div>
            )}
        </div>
    );
}

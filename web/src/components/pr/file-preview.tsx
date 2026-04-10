"use client";

/**
 * FilePreview — inline local preview of a queued upload file.
 *
 * Renders a media-appropriate preview using object URLs (never uploaded content).
 * Cleans up the object URL on unmount.
 *
 * Supported:
 *   - Images (all browser-native formats)
 *   - Video (mp4, webm)
 *   - Audio (mp3, ogg, flac, wav, m4a, aac)
 *   - Text / code (plain-text, markdown, CSV, JSON, YAML, source files ≤ 256 KiB)
 *   - PDF — icon badge only (rendering requires a full PDF viewer)
 *   - Other — generic file icon with extension badge
 */

import { useEffect, useRef, useState } from "react";
import { FileText, Music, Video, Code } from "lucide-react";

interface FilePreviewProps {
    file: File;
    /** Width in pixels (default: 36) */
    size?: number;
    /** When true shows full preview in a larger tile; otherwise thumbnail only */
    expanded?: boolean;
}

const TEXT_EXTENSIONS = new Set([
    ".txt", ".md", ".markdown", ".csv", ".json", ".yaml", ".yml",
    ".toml", ".ini", ".cfg", ".conf", ".tex", ".latex", ".log",
    ".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".c", ".cpp",
    ".h", ".hpp", ".rs", ".go", ".rb", ".php", ".cs", ".swift",
    ".kt", ".scala", ".css", ".scss", ".sql", ".sh", ".bash",
    ".zsh", ".lua", ".r", ".m", ".ml", ".hs", ".ex", ".exs", ".clj",
]);

const MAX_TEXT_PREVIEW_BYTES = 256 * 1024; // 256 KiB

function getExtension(name: string): string {
    const idx = name.lastIndexOf(".");
    return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

function isTextFile(file: File): boolean {
    if (file.type.startsWith("text/")) return true;
    const ext = getExtension(file.name);
    return TEXT_EXTENSIONS.has(ext);
}

// ── Thumbnail (compact, always shown) ────────────────────────────────────────

export function FilePreviewThumbnail({
    file,
    size = 36,
}: {
    file: File;
    size?: number;
}) {
    const [objectUrl, setObjectUrl] = useState<string | null>(null);

    const [prevFile, setPrevFile] = useState<File | null>(null);
    if (file !== prevFile) {
        setPrevFile(file);
        setObjectUrl(null);
    }

    useEffect(() => {
        if (file.type.startsWith("image/")) {
            const url = URL.createObjectURL(file);
            setObjectUrl(url);
            return () => URL.revokeObjectURL(url);
        }
    }, [file]);

    const ext = getExtension(file.name).slice(1, 4).toUpperCase();
    const style = { width: size, height: size };

    if (objectUrl) {
        return (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
                src={objectUrl}
                alt={file.name}
                className="rounded border object-cover bg-muted/50"
                style={style}
            />
        );
    }

    if (file.type === "application/pdf") {
        return (
            <div
                className="rounded border bg-muted/50 flex flex-col items-center justify-center gap-0.5"
                style={style}
                aria-label="PDF file"
            >
                <FileText className="text-red-500" style={{ width: size * 0.44, height: size * 0.44 }} />
                <span className="text-[8px] font-bold text-red-500">PDF</span>
            </div>
        );
    }

    if (file.type.startsWith("video/")) {
        return (
            <div
                className="rounded border bg-muted/50 flex flex-col items-center justify-center gap-0.5"
                style={style}
                aria-label="Video file"
            >
                <Video className="text-blue-500" style={{ width: size * 0.44, height: size * 0.44 }} />
                <span className="text-[8px] font-bold text-blue-500">{ext}</span>
            </div>
        );
    }

    if (file.type.startsWith("audio/")) {
        return (
            <div
                className="rounded border bg-muted/50 flex flex-col items-center justify-center gap-0.5"
                style={style}
                aria-label="Audio file"
            >
                <Music className="text-purple-500" style={{ width: size * 0.44, height: size * 0.44 }} />
                <span className="text-[8px] font-bold text-purple-500">{ext}</span>
            </div>
        );
    }

    if (isTextFile(file)) {
        return (
            <div
                className="rounded border bg-muted/50 flex flex-col items-center justify-center gap-0.5"
                style={style}
                aria-label="Text file"
            >
                <Code className="text-muted-foreground/60" style={{ width: size * 0.44, height: size * 0.44 }} />
                <span className="text-[8px] font-medium text-muted-foreground/60">{ext || "TXT"}</span>
            </div>
        );
    }

    // Generic fallback
    return (
        <div
            className="rounded border bg-muted/50 flex flex-col items-center justify-center gap-0.5"
            style={style}
            aria-label={`${ext || "Unknown"} file`}
        >
            <FileText className="text-muted-foreground/60" style={{ width: size * 0.44, height: size * 0.44 }} />
            <span className="text-[8px] font-medium text-muted-foreground/60">{ext || "FILE"}</span>
        </div>
    );
}

// ── Expanded preview (shown in modal/detail view) ─────────────────────────────

export function FilePreviewExpanded({ file }: { file: File }) {
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [textContent, setTextContent] = useState<string | null>(null);

    const [prevFile, setPrevFile] = useState<File | null>(null);
    if (file !== prevFile) {
        setPrevFile(file);
        setTextContent(null);
        setObjectUrl(null);
    }

    useEffect(() => {
        let cancelled = false;

        if (file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/")) {
            const url = URL.createObjectURL(file);
            setObjectUrl(url);
            return () => URL.revokeObjectURL(url);
        }

        if (isTextFile(file) && file.size <= MAX_TEXT_PREVIEW_BYTES) {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (!cancelled) setTextContent(e.target?.result as string ?? null);
            };
            reader.readAsText(file);
        }

        return () => { cancelled = true; };
    }, [file]);

    if (file.type.startsWith("image/") && objectUrl) {
        return (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
                src={objectUrl}
                alt={file.name}
                className="max-h-[400px] w-full rounded-lg object-contain bg-muted/30"
            />
        );
    }

    if (file.type.startsWith("video/") && objectUrl) {
        return (
             
            <video
                src={objectUrl}
                controls
                className="w-full max-h-[400px] rounded-lg bg-black"
                aria-label={file.name}
            />
        );
    }

    if (file.type.startsWith("audio/") && objectUrl) {
        return (
            <audio
                src={objectUrl}
                controls
                className="w-full"
                aria-label={file.name}
            />
        );
    }

    if (textContent !== null) {
        return (
            <pre
                className="max-h-[300px] overflow-auto rounded-lg bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words"
                aria-label={`Text preview of ${file.name}`}
            >
                {textContent}
            </pre>
        );
    }

    // Fallback: thumbnail + file info
    return (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
            <FilePreviewThumbnail file={file} size={48} />
            <div>
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                    {file.type || "Unknown type"} · {(file.size / 1024).toFixed(0)} KB
                </p>
            </div>
        </div>
    );
}

// ── Default export: unified component ────────────────────────────────────────

export function FilePreview({ file, size = 36, expanded = false }: FilePreviewProps) {
    if (expanded) return <FilePreviewExpanded file={file} />;
    return <FilePreviewThumbnail file={file} size={size} />;
}

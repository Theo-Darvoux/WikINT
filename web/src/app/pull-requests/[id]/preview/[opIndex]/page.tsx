"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertCircle, FileText, Image as ImageIcon, Video as VideoIcon, Music, Code2, Eye, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";
import { getFileBadgeColor, getFileBadgeLabel, getFileExtension } from "@/lib/file-utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// pdfjs must be client-only (uses Promise.withResolvers at module-eval time)
const PdfPreview = dynamic(
    () => import("@/components/pr/pdf-preview").then((m) => m.PdfPreview),
    {
        ssr: false,
        loading: () => (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        ),
    },
);

/* ── Viewer type resolution (mirrors material-viewer.tsx) ──────────────────── */

const MIME_TO_VIEWER: Record<string, string> = {
    "application/pdf": "pdf",
    "text/markdown": "markdown",
    "text/x-markdown": "markdown",
    "image/png": "image",
    "image/jpeg": "image",
    "image/gif": "image",
    "image/webp": "image",
    "image/svg+xml": "image",
    "video/mp4": "video",
    "video/webm": "video",
    "video/ogg": "video",
    "audio/mpeg": "audio",
    "audio/wav": "audio",
    "audio/ogg": "audio",
    "audio/flac": "audio",
    "audio/aac": "audio",
    "audio/mp3": "audio",
    "text/csv": "csv",
    "application/csv": "csv",
};

const EXT_TO_VIEWER: Record<string, string> = {
    pdf: "pdf", md: "markdown", markdown: "markdown",
    png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image",
    mp4: "video", webm: "video", mov: "video",
    mp3: "audio", wav: "audio", flac: "audio", m4a: "audio", aac: "audio",
    csv: "csv",
};

const TEXT_EXTS = new Set([
    "txt", "log", "ini", "cfg", "conf", "tex", "latex",
    "js", "ts", "jsx", "tsx", "py", "java", "c", "cpp", "h", "hpp",
    "rs", "go", "rb", "php", "cs", "swift", "kt", "scala",
    "html", "css", "scss", "json", "yaml", "yml", "toml", "xml",
    "sql", "sh", "bash", "zsh", "lua", "r",
]);

function getViewerType(mimeType: string, fileName: string): string {
    if (MIME_TO_VIEWER[mimeType]) return MIME_TO_VIEWER[mimeType];
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("text/")) return "code";
    const ext = getFileExtension(fileName);
    if (EXT_TO_VIEWER[ext]) return EXT_TO_VIEWER[ext];
    if (TEXT_EXTS.has(ext)) return "code";
    return "generic";
}

/* ── Sub-viewers ───────────────────────────────────────────────────────────── */

function TextPreview({ url, type }: { url: string; type: "markdown" | "code" | "csv" }) {
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetch(url)
            .then((r) => r.text())
            .then((t) => { if (!cancelled) setContent(t); })
            .catch(() => { if (!cancelled) setError(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [url]);

    if (loading) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
    if (error) return <div className="flex h-full items-center justify-center text-sm text-destructive">Failed to load content</div>;

    if (type === "markdown") {
        return (
            <div className="prose prose-sm dark:prose-invert max-w-3xl mx-auto h-full overflow-y-auto px-8 py-8">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
        );
    }
    return (
        <pre className="h-full overflow-auto bg-muted/10 p-6 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed">
            {content}
        </pre>
    );
}

function GenericFallback({ url, fileName, mimeType }: { url: string; fileName: string; mimeType: string }) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <FileText className="h-16 w-16 text-muted-foreground/30" />
            <div>
                <p className="font-medium">{fileName}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{mimeType || "Unknown type"} — preview unavailable</p>
            </div>
            <div className="flex gap-2">
                <Button asChild variant="outline">
                    <a href={url} download={fileName}>
                        <Download className="mr-1.5 h-4 w-4" />
                        Download
                    </a>
                </Button>
                <Button asChild variant="outline">
                    <a href={url} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-1.5 h-4 w-4" />
                        Open in new tab
                    </a>
                </Button>
            </div>
        </div>
    );
}

const VIEWER_ICONS: Record<string, React.ElementType> = {
    pdf: FileText, image: ImageIcon, video: VideoIcon, audio: Music,
    markdown: Code2, code: Code2, csv: Code2, generic: Eye,
};
const VIEWER_ICON_COLORS: Record<string, string> = {
    pdf: "text-red-500", image: "text-blue-500", video: "text-purple-500",
    audio: "text-pink-500", markdown: "text-green-600", code: "text-amber-500",
    csv: "text-teal-500", generic: "text-muted-foreground",
};

/* ── Page ──────────────────────────────────────────────────────────────────── */

interface PageProps {
    params: Promise<{ id: string; opIndex: string }>;
}

export default function PRPreviewPage({ params }: PageProps) {
    const { id: prId, opIndex: opIndexStr } = use(params);
    const opIndex = Number(opIndexStr);
    const router = useRouter();

    const [presignedUrl, setPresignedUrl] = useState<string | null>(null);
    const [fileName, setFileName] = useState<string>("");
    const [mimeType, setMimeType] = useState<string>("");
    const [prTitle, setPrTitle] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                // Fetch PR metadata (for filename/mimetype) and presigned URL in parallel
                const [pr, preview] = await Promise.all([
                    apiFetch<{ title: string; payload: Record<string, unknown>[] }>(`/pull-requests/${prId}`),
                    apiFetch<{ url: string; file_name?: string; file_mime_type?: string }>(`/pull-requests/${prId}/preview?opIndex=${opIndex}`),
                ]);

                if (cancelled) return;

                const op = pr.payload?.[opIndex] ?? {};
                setFileName(String(preview.file_name ?? op.file_name ?? "File"));
                setMimeType(String(preview.file_mime_type ?? op.file_mime_type ?? ""));
                setPrTitle(pr.title);
                setPresignedUrl(preview.url);
            } catch (e: unknown) {
                if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load preview");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [prId, opIndex]);

    const viewerType = presignedUrl ? getViewerType(mimeType, fileName) : "generic";
    const Icon = VIEWER_ICONS[viewerType] ?? Eye;
    const iconColor = VIEWER_ICON_COLORS[viewerType] ?? "";

    return (
        <div className="flex h-[calc(100vh-3.5rem)] flex-col">
            {/* Header */}
            <div className="flex shrink-0 items-center gap-3 border-b bg-background px-4 py-2.5">
                <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => router.back()}
                    title="Back to contribution"
                >
                    <ArrowLeft className="h-4 w-4" />
                </Button>

                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
                    <span className="truncate text-sm font-medium">{fileName || "Preview"}</span>
                    {fileName && (
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${getFileBadgeColor(fileName)}`}>
                            {getFileBadgeLabel(fileName, mimeType)}
                        </span>
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {prTitle && (
                        <Badge variant="secondary" className="hidden sm:flex gap-1 text-xs font-normal">
                            Contribution ·
                            <Link href={`/pull-requests/${prId}`} className="hover:underline truncate max-w-[160px]">
                                {prTitle}
                            </Link>
                        </Badge>
                    )}
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                        Pending
                    </Badge>
                </div>
            </div>

            {/* Viewer area */}
            <div className="relative flex-1 min-h-0 overflow-hidden">
                {loading && (
                    <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                )}

                {!loading && error && (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center p-8">
                        <AlertCircle className="h-10 w-10 text-destructive/50" />
                        <div>
                            <p className="font-medium text-destructive">Preview unavailable</p>
                            <p className="text-sm text-muted-foreground mt-1">{error}</p>
                        </div>
                        <Button variant="outline" onClick={() => router.back()}>
                            Back to contribution
                        </Button>
                    </div>
                )}

                {!loading && !error && presignedUrl && (
                    <>
                        {viewerType === "pdf" && (
                            <PdfPreview key={presignedUrl} url={presignedUrl} />
                        )}
                        {viewerType === "image" && (
                            <div className="flex h-full items-center justify-center bg-muted/10 p-4">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={presignedUrl}
                                    alt={fileName}
                                    className="max-h-full max-w-full rounded-lg object-contain"
                                />
                            </div>
                        )}
                        {viewerType === "video" && (
                            <div className="flex h-full items-center justify-center bg-black">
                                <video src={presignedUrl} controls className="max-h-full max-w-full" />
                            </div>
                        )}
                        {viewerType === "audio" && (
                            <div className="flex h-full items-center justify-center p-8">
                                <audio src={presignedUrl} controls className="w-full max-w-xl" />
                            </div>
                        )}
                        {(viewerType === "markdown" || viewerType === "code" || viewerType === "csv") && (
                            <TextPreview key={presignedUrl} url={presignedUrl} type={viewerType} />
                        )}
                        {viewerType === "generic" && (
                            <GenericFallback url={presignedUrl} fileName={fileName} mimeType={mimeType} />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

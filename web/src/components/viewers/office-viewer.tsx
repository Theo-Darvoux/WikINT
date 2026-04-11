"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { FullscreenToggle } from "./fullscreen-toggle";
import { ViewerToolbar } from "./viewer-toolbar";
import { registerOfficePrint, unregisterOfficePrint } from "@/lib/office-print-registry";
import { toast } from "sonner";

const ONLYOFFICE_URL =
    process.env.NEXT_PUBLIC_ONLYOFFICE_URL ?? "http://localhost/onlyoffice";
const ONLYOFFICE_API_JS = `${ONLYOFFICE_URL}/web-apps/apps/api/documents/api.js`;

interface OfficeViewerProps {
    fileKey: string;
    materialId: string;
    fileName: string;
    mimeType: string;
}

// Cache the script-load promise so navigating between office documents
// doesn't inject duplicate <script> tags into the document head.
let scriptLoadPromise: Promise<void> | null = null;

const SCRIPT_LOAD_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
    return Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
    ]);
}

function loadOnlyOfficeScript(): Promise<void> {
    if (scriptLoadPromise) return scriptLoadPromise;
    scriptLoadPromise = new Promise((resolve, reject) => {
        // Already loaded (e.g. hot-reload)
        if (typeof window !== "undefined" && (window as unknown as Record<string, unknown>).DocsAPI) {
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.src = ONLYOFFICE_API_JS;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
            scriptLoadPromise = null; // allow retry on next mount
            reject(new Error("Failed to load ONLYOFFICE API script"));
        };
        document.head.appendChild(script);
    });
    return scriptLoadPromise;
}

interface OnlyOfficeDocEditor {
    destroyEditor: () => void;
}

interface OnlyOfficeDocsAPI {
    DocEditor: new (id: string, config: unknown) => OnlyOfficeDocEditor;
}

declare global {
    interface Window {
        DocsAPI?: OnlyOfficeDocsAPI;
    }
}

type LoadingStage = "config" | "script" | "editor" | "ready";

export function OfficeViewer({ materialId, fileName }: OfficeViewerProps) {
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingStage, setLoadingStage] = useState<LoadingStage>("config");
    const [retryCount, setRetryCount] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const editorInstanceRef = useRef<{ destroyEditor: () => void } | null>(null);
    // The editor div is created imperatively so React never tracks its children.
    // This prevents the Node.removeChild DOMException that occurs when ONLYOFFICE
    // modifies the DOM and React's reconciler later tries to clean up the same nodes.
    const editorDivRef = useRef<HTMLDivElement | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, toggleFullscreen, supportsFullscreen } = useFullscreen(wrapperRef);

    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };
        checkMobile();
        window.addEventListener("resize", checkMobile);
        return () => window.removeEventListener("resize", checkMobile);
    }, []);

    useEffect(() => {
        if (isMobile) return;
        let cancelled = false;

        const startInit = () => {
            setLoading(true);
            setError(null);
            setLoadingStage("config");
        };

        // materialId alone is sufficient because cleanup removes the div.
        const editorId = `onlyoffice-editor-${materialId}`;

        // Create the target div imperatively and append to the React-managed container.
        // React only knows about the container div (always childless in the vdom).
        const editorDiv = document.createElement("div");
        editorDiv.id = editorId;
        editorDiv.style.height = "100%";
        editorDiv.style.width = "100%";
        if (containerRef.current) {
            containerRef.current.appendChild(editorDiv);
        }
        editorDivRef.current = editorDiv;

        async function init() {
            startInit();
            try {
                // 1. Fetch signed editor config from API (user-authenticated)
                const config = await apiFetch<Record<string, unknown>>(
                    `/onlyoffice/config/${materialId}`
                );

                if (cancelled) return;
                setLoadingStage("script");

                // 2. Load ONLYOFFICE JS API (cached after first load)
                await withTimeout(
                    loadOnlyOfficeScript(),
                    SCRIPT_LOAD_TIMEOUT_MS,
                    "ONLYOFFICE service did not respond in time"
                );

                if (cancelled) return;
                setLoadingStage("editor");

                // 3. Destroy any previous editor instance
                if (editorInstanceRef.current) {
                    try {
                        editorInstanceRef.current.destroyEditor();
                    } catch {
                        /* ignore */
                    }
                    editorInstanceRef.current = null;
                }

                const DocsAPI = window.DocsAPI;

                if (!DocsAPI) {
                    setError("ONLYOFFICE preview service is unavailable.");
                    setLoading(false);
                    return;
                }

                // 4. Initialize editor in embedded (minimal UI) mode
                const editor = new DocsAPI.DocEditor(editorId, {
                    ...config,
                    height: "100%",
                    width: "100%",
                    type: "embedded",
                    events: {
                        onDocumentReady: () => {
                            if (!cancelled) {
                                setLoadingStage("ready");
                                setLoading(false);
                                // Label the OO iframe for screen readers as soon as it is ready.
                                const iframe = containerRef.current?.querySelector(
                                    "iframe"
                                ) as HTMLIFrameElement | null;
                                if (iframe) {
                                    iframe.setAttribute("title", `Document preview: ${fileName}`);
                                    iframe.setAttribute("aria-label", `Document preview: ${fileName}`);
                                }
                                registerOfficePrint(materialId, () => {
                                    // The print UI lives inside the cross-origin
                                    // OnlyOffice iframe. When same-origin (production,
                                    // or dev via nginx on port 80), we can click the
                                    // button directly. Otherwise fall back to a hint.
                                    const container = containerRef.current;
                                    const iframe = container?.querySelector(
                                        "iframe"
                                    ) as HTMLIFrameElement | null;
                                    if (!iframe?.contentWindow) return;
                                    try {
                                        const iframeDoc =
                                            iframe.contentDocument || iframe.contentWindow.document;
                                        const btn = iframeDoc?.getElementById(
                                            "idt-print"
                                        ) as HTMLElement | null;
                                        if (btn) {
                                            btn.click();
                                            return;
                                        }
                                    } catch {
                                        // Cross-origin — can't access iframe DOM
                                    }
                                    // Fallback: post the print command and hope the
                                    // embedded editor handles it. If not, inform user.
                                    toast.info(
                                        "Please use the print button inside the document viewer (⋮ menu)."
                                    );
                                });
                            }
                        },
                        onError: (event: { data?: number }) => {
                            const OO_ERROR_MESSAGES: Partial<Record<number, string>> = {
                                [-1]: "Unknown error in document viewer.",
                                [-2]: "Conversion timed out. The document may be too large.",
                                [-4]: "Document download failed. The preview service may be misconfigured.",
                            };
                            const code = event?.data;
                            const msg =
                                typeof code === "number" && OO_ERROR_MESSAGES[code]
                                    ? OO_ERROR_MESSAGES[code]!
                                    : "Failed to load document preview.";
                            console.error("ONLYOFFICE error:", code, msg);
                            if (!cancelled) {
                                setError(msg);
                                setLoading(false);
                            }
                        },
                    },
                });
                editorInstanceRef.current = editor;
            } catch (err: unknown) {
                if (!cancelled) {
                    console.error("OfficeViewer init error:", err);
                    const message = err instanceof Error ? err.message : String(err);
                    const isColdStart =
                        message.includes("timeout") ||
                        message.includes("fetch") ||
                        message.includes("respond");

                    if (isColdStart && retryCount < 3) {
                        const nextRetry = retryCount + 1;
                        setError(`Viewer is starting up — retrying (${nextRetry}/3)...`);
                        setTimeout(() => {
                            if (!cancelled) setRetryCount(nextRetry);
                        }, 15000);
                    } else {
                        setError(
                            message ||
                                "Document preview service is unavailable. Please download the file to view it."
                        );
                        setLoading(false);
                    }
                }
            }
        }

        init();

        return () => {
            cancelled = true;
            unregisterOfficePrint(materialId);
            // Destroy the editor instance (ONLYOFFICE removes its own DOM nodes).
            if (editorInstanceRef.current) {
                try {
                    editorInstanceRef.current.destroyEditor();
                } catch {
                    /* ignore */
                }
                editorInstanceRef.current = null;
            }
            // Remove the imperative div from the container ourselves.
            // React never knew about this div, so it won't try to remove it.
            const div = editorDivRef.current;
            if (div && div.parentNode) {
                try {
                    div.parentNode.removeChild(div);
                } catch {
                    /* ignore */
                }
            }
            editorDivRef.current = null;
        };
    }, [materialId, retryCount, fileName, isMobile]);

    if (isMobile) {
        return (
            <div role="alert" className="flex flex-col items-center justify-center p-8 text-center gap-4 text-muted-foreground h-full">
                <div className="flex flex-col items-center gap-2">
                    <p className="text-lg font-medium text-foreground">Mobile View Restricted</p>
                    <p className="text-sm max-w-xs">
                        This document is best viewed on a desktop. Download to open it locally on your device.
                    </p>
                </div>
                <button
                    onClick={async () => {
                        try {
                            const data = await apiFetch<{ url: string }>(
                                `/materials/${materialId}/download-url`
                            );
                            window.location.href = data.url;
                        } catch {
                            toast.error("Download failed. Please try again.");
                        }
                    }}
                    className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
                >
                    Download File
                </button>
            </div>
        );
    }

    if (error) {
        return (
            <div role="alert" className="flex flex-col items-center justify-center p-8 text-center gap-4 text-muted-foreground h-full">
                <div className="flex flex-col items-center gap-2">
                    <p className="text-lg font-medium text-foreground">Preview Unavailable</p>
                    <p className="text-sm max-w-xs">{error}</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => {
                            setLoading(true);
                            setError(null);
                            setLoadingStage("config");
                            setRetryCount(0); // Reset retry count on manual retry
                        }}
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2"
                    >
                        Retry Preview
                    </button>
                    <a
                        href={`/api/materials/${materialId}/file`}
                        download
                        className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
                    >
                        Download File
                    </a>
                </div>
            </div>
        );
    }

    const stageLabels: Record<LoadingStage, string> = {
        config: "Fetching configuration...",
        script: "Loading viewer engine...",
        editor: "Initializing editor...",
        ready: "Ready",
    };

    return (
        <div
            ref={wrapperRef}
            className={cn(
                "relative flex flex-col bg-background min-w-0 w-full",
                isFullscreen ? "h-screen" : "h-full"
            )}
        >
            <ViewerToolbar 
                isFullscreen={isFullscreen}
                left={
                    <div className="flex items-center gap-2 overflow-hidden">
                        {!loading && fileName && (
                            <span className="text-xs font-medium uppercase text-muted-foreground px-1.5 py-0.5 bg-muted rounded truncate">
                                {fileName.split(".").pop()?.toUpperCase()}
                            </span>
                        )}
                        {!loading && fileName && (
                            <span className="text-xs font-medium text-muted-foreground truncate hidden sm:inline">
                                {fileName}
                            </span>
                        )}
                    </div>
                }
                right={
                    supportsFullscreen && (
                        <FullscreenToggle
                            isFullscreen={isFullscreen}
                            onToggle={toggleFullscreen}
                            disabled={loading}
                            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                        />
                    )
                }
            />

            <div className="relative flex-1 min-h-0 bg-muted/20">
                {loading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/50 backdrop-blur-sm gap-4">
                        <div className="w-full max-w-md px-8 space-y-4">
                            <div className="space-y-2">
                                <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
                                <div className="h-4 w-full bg-muted animate-pulse rounded" />
                                <div className="h-4 w-5/6 bg-muted animate-pulse rounded" />
                            </div>
                            <div className="flex flex-col items-center gap-2 pt-4" role="status" aria-live="polite">
                                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                <p className="text-sm font-medium text-muted-foreground animate-pulse">
                                    {stageLabels[loadingStage]}
                                </p>
                            </div>
                        </div>
                    </div>
                )}
                {/* React only manages this container — ONLYOFFICE's div is appended imperatively */}
                <div ref={containerRef} className="h-full w-full" />
            </div>
        </div>
    );
}

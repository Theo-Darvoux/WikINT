import * as tus from "tus-js-client";
import { API_BASE, ApiError, apiRequest, getClientId } from "@/lib/api-client";
import { getAccessToken } from "@/lib/auth-tokens";
import { sha256File } from "@/lib/crypto-utils";
import { compressImageIfNeeded } from "@/lib/file-utils";

export type UploadStatus = "pending" | "processing" | "clean" | "malicious" | "failed";

export interface TusUploadHandle {
    pause(): void;
    resume(): void;
    abort(sendDelete?: boolean): void;
}

export interface UploadFileOptions {
    /**
     * Progress callback. Values:
     *   0–5    SHA-256 computation
     *   5–80   Transfer to S3 (XHR PUT for small files, tus chunks for large)
     *   80–99  Server-side processing (via SSE overall_percent)
     *   100    Complete
     */
    onProgress?: (pct: number) => void;
    /** Called with granular server status messages (e.g. "Scanning for malware…"). */
    onStatusUpdate?: (status: string) => void;
    /** Called with raw byte progress. */
    onBytesProgress?: (uploaded: number, total: number) => void;
    /** Called when a tus upload is ready to be controlled (paused/resumed). */
    onTusReady?: (handle: TusUploadHandle) => void;
    /** Called when the tus Location URL is available (for persistence). */
    onTusUrlAvailable?: (url: string) => void;
    signal?: AbortSignal;
    /** Stable UUID for this upload attempt — enables server-side idempotency on retry. */
    uploadId?: string;
    /** Optional tus URL to resume from. */
    tusUrl?: string;
    /** Skip client-side image compression (useful for 4K+ scans) (U10). */
    skipCompression?: boolean;
}

export interface UploadResult {
    file_key: string;
    size: number;
    /** Size before server-side compression/optimisation. Equals size if unchanged. */
    original_size: number;
    mime_type: string;
    /** Server-corrected filename (e.g. misnamed .wav → .flac). */
    correctedName: string;
    /** True when client-side image compression was applied before upload. */
    wasCompressed: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Files above this threshold are uploaded via tus (resumable chunked); below go via presigned PUT. */
const TUS_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5 MiB

/** Files above this threshold use direct-to-S3 multipart; below go via tus. */
const PRESIGNED_MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MiB

/** tus chunk size — must satisfy S3 minimum part size (5 MiB) for non-final parts. */
const TUS_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB

/** Direct S3 multipart part size. */
const S3_PART_SIZE = 8 * 1024 * 1024; // 8 MiB

// ── Internal types ────────────────────────────────────────────────────────────

interface CheckExistsResponse {
    exists: boolean;
    file_key?: string;
}
interface InitUploadResponse {
    quarantine_key: string;
    upload_id: string;
    presigned_url: string;
}

interface InitMultipartResponse {
    quarantine_key: string;
    upload_id: string;
    s3_multipart_id: string;
    parts: Array<{
        part_number: number;
        url: string;
    }>;
}

interface UploadEventPayload {
    file_key: string;
    status: UploadStatus;
    detail?: string;
    result?: {
        file_key: string;
        size: number;
        original_size: number;
        mime_type: string;
    };
    stage_index?: number;
    stage_total?: number;
    stage_percent?: number;
    overall_percent?: number;
}

export interface UploadConfig {
    allowed_extensions: string[];
    allowed_mimetypes: string[];
    max_file_size_mb: number;
}

let _configCache: UploadConfig | null = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Fetch upload configuration (allowed types, size limits) from the backend. */
export async function getUploadConfig(): Promise<UploadConfig> {
    const now = Date.now();
    if (_configCache && (now - _configCacheTime < CONFIG_CACHE_TTL)) {
        return _configCache;
    }
    const resp = await apiRequest("/upload/config");
    const config = await resp.json() as UploadConfig;
    _configCache = config;
    _configCacheTime = now;
    return config;
}

// ── Retry helpers ─────────────────────────────────────────────────────────────

const _MAX_RETRIES = 3;

function _isRetryable(status: number): boolean {
    return status === 429 || status >= 500;
}

function _sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Upload cancelled"));
        }, { once: true });
    });
}

// ── XHR PUT to presigned S3 URL ───────────────────────────────────────────────

function _xhrPut(
    url: string,
    file: File,
    onProgress?: (pct: number) => void,
    onBytesProgress?: (uploaded: number, total: number) => void,
    signal?: AbortSignal,
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error("Upload cancelled"));
            return;
        }

        const xhr = new XMLHttpRequest();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                // Maps to the 5–80 range
                onProgress?.(5 + Math.round((e.loaded / e.total) * 75));
                onBytesProgress?.(e.loaded, e.total);
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                reject(new ApiError(xhr.status, `S3 PUT failed with status ${xhr.status}`));
            }
        };

        xhr.onerror = () => reject(new Error("Network error during S3 upload"));
        xhr.onabort = () => reject(new Error("Upload cancelled"));

        xhr.open("PUT", url);
        // S3 presigned PUT requires the Content-Type to match what was signed
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

        signal?.addEventListener("abort", () => xhr.abort(), { once: true });

        xhr.send(file);
    });
}
async function _xhrPutWithRetry(
    url: string,
    file: File,
    onProgress?: (pct: number) => void,
    onBytesProgress?: (uploaded: number, total: number) => void,
    signal?: AbortSignal,
): Promise<void> {
    let attempts = 0;
    while (attempts < _MAX_RETRIES) {
        try {
            return await _xhrPut(url, file, onProgress, onBytesProgress, signal);
        } catch (err) {
            attempts++;
            const isLast = attempts >= _MAX_RETRIES;
            const retryable = err instanceof ApiError && _isRetryable(err.status);
            const isNetwork =
                !(err instanceof ApiError) &&
                err instanceof Error &&
                err.message.startsWith("Network error");

            if (isLast || (!retryable && !isNetwork)) throw err;
            const delay = Math.min(1000 * 2 ** attempts, 30_000);
            await _sleep(delay, signal);
        }
    }
}

function _xhrPutPart(
    url: string,
    blob: Blob,
    onPartProgress: (partPct: number) => void,
    signal?: AbortSignal,
    partNumber?: number,
): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onPartProgress((e.loaded / e.total) * 100);
        };
        xhr.onload = () => {
            const etagHeader = xhr.getResponseHeader("ETag");
            if (xhr.status >= 200 && xhr.status < 300 && etagHeader) {
                resolve(etagHeader);
            } else {
                reject(new ApiError(xhr.status, `Part ${partNumber} failed: ${xhr.status}`));
            }
        };
        xhr.onerror = () => reject(new Error(`Network error on part ${partNumber}`));
        xhr.onabort = () => reject(new Error("Upload cancelled"));

        if (signal) {
            signal.addEventListener("abort", () => xhr.abort(), { once: true });
        }
        xhr.send(blob);
    });
}

async function _xhrPutPartWithRetry(
    url: string,
    blob: Blob,
    onPartProgress: (partPct: number) => void,
    signal?: AbortSignal,
    partNumber?: number,
): Promise<string> {
    let attempts = 0;
    while (attempts < _MAX_RETRIES) {
        try {
            return await _xhrPutPart(url, blob, onPartProgress, signal, partNumber);
        } catch (err) {
            attempts++;
            const isLast = attempts >= _MAX_RETRIES;
            const retryable = err instanceof ApiError && _isRetryable(err.status);
            const isNetwork =
                !(err instanceof ApiError) &&
                err instanceof Error &&
                (err.message.startsWith("Network error") || err.message.includes("failed"));

            if (isLast || (!retryable && !isNetwork)) throw err;
            const delay = Math.min(1000 * 2 ** attempts, 30_000);
            await _sleep(delay, signal);
        }
    }
    throw new Error(`Failed to upload part ${partNumber} after ${_MAX_RETRIES} attempts`);
}

// ── Direct S3 multipart path (extra-large files) ─────────────────────────────

async function _presignedMultipartUpload(
    file: File,
    options: UploadFileOptions,
): Promise<string> {
    const { onProgress, onStatusUpdate, onBytesProgress, signal, uploadId } = options;
    const token = getAccessToken();
    const baseHeaders: Record<string, string> = { "X-Client-ID": getClientId() };
    if (token) baseHeaders["Authorization"] = `Bearer ${token}`;

    _onStatusUpdate(onStatusUpdate, "Preparing multipart…");

    const initResp = await apiRequest("/upload/presigned-multipart/init", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...baseHeaders },
        body: JSON.stringify({
            filename: file.name,
            size: file.size,
            mime_type: file.type || "application/octet-stream",
            upload_id: uploadId,
        }),
        signal,
    }).then((r) => r.json() as Promise<InitMultipartResponse>);

    const parts = initResp.parts;

    _onStatusUpdate(onStatusUpdate, "Uploading chunks…");

    const CONCURRENCY = 4;
    const etags: Array<{ PartNumber: number; ETag: string }> = [];
    const progressPerPart: Record<number, number> = {};
    let activePromises: Promise<void>[] = [];

    const calculateProgress = () => {
        const totalUploaded = Object.values(progressPerPart).reduce((a, b) => a + b, 0);
        onProgress?.(5 + Math.round((totalUploaded / file.size) * 75));
        onBytesProgress?.(totalUploaded, file.size);
    };

    const tasks = parts.map((p) => async () => {
        const start = (p.part_number - 1) * S3_PART_SIZE;
        const end = Math.min(start + S3_PART_SIZE, file.size);
        const blob = file.slice(start, end);
        const partSize = end - start;

        const onPartProgress = (partPct: number) => {
            progressPerPart[p.part_number] = (partPct / 100) * partSize;
            calculateProgress();
        };

        const etag = await _xhrPutPartWithRetry(
            p.url,
            blob,
            onPartProgress,
            signal,
            p.part_number,
        );

        etags.push({ PartNumber: p.part_number, ETag: etag });
        progressPerPart[p.part_number] = partSize;
        calculateProgress();
    });

    try {
        for (const task of tasks) {
            const promise = task().finally(() => {
                activePromises = activePromises.filter((p) => p !== promise);
            });
            activePromises.push(promise);
            if (activePromises.length >= CONCURRENCY) {
                await Promise.race(activePromises);
            }
        }
        await Promise.all(activePromises);
        etags.sort((a, b) => a.PartNumber - b.PartNumber); // Ensure sorted for S3 Complete

        _onStatusUpdate(onStatusUpdate, "Finalising multipart…");

        await apiRequest("/upload/presigned-multipart/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...baseHeaders },
            body: JSON.stringify({
                upload_id: initResp.upload_id,
                parts: etags,
            }),
            signal,
        });

        return initResp.quarantine_key;
    } catch (err) {
        // Abort S3 multipart to free orphaned parts immediately (audit review fix)
        try {
            await apiRequest(`/upload/presigned-multipart/${initResp.upload_id}`, {
                method: "DELETE",
                headers: baseHeaders,
            });
        } catch { /* best-effort cleanup */ }
        throw err;
    }
}

// ── tus upload path (large files) ────────────────────────────────────────────

/**
 * Upload a large file (≥ TUS_THRESHOLD_BYTES) via tus 1.0.0.
 *
 * Returns the quarantine_key once the upload is complete and the worker has
 * been enqueued. The caller then subscribes to the SSE stream for processing status.
 */
function _tusUpload(
    file: File,
    options: UploadFileOptions,
): Promise<string> {
    const { onProgress, onStatusUpdate, signal } = options;

    return new Promise<string>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error("Upload cancelled"));
            return;
        }

        const token = getAccessToken();
        const headers: Record<string, string> = {
            "X-Client-ID": getClientId(),
        };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        let quarantineKey: string | undefined;

        const upload = new tus.Upload(file, {
            endpoint: `${API_BASE}/upload/tus`,
            uploadUrl: options.tusUrl,
            chunkSize: TUS_CHUNK_SIZE,
            retryDelays: [0, 1000, 3000, 5000],
            headers,
            metadata: {
                filename: file.name,
                filetype: file.type || "application/octet-stream",
            },
            // (O12) Per-chunk SHA-256 checksum via crypto.subtle (audit fix #12)
            onBeforeRequest: (req) => {
                const originalSend = req.send.bind(req);
                req.send = async (body) => {
                    const method = req.getMethod();
                    if (method === "PATCH" && (body instanceof Blob || body instanceof File)) {
                        const buffer = await body.arrayBuffer();
                        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
                        const b64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
                        req.setHeader("Upload-Checksum", `sha256 ${b64}`);
                    }
                    return originalSend(body);
                };
            },
            onProgress: (bytesUploaded, bytesTotal) => {
                // Map 5–80% range (same as presigned XHR path)
                onProgress?.(5 + Math.round((bytesUploaded / bytesTotal) * 75));
                options.onBytesProgress?.(bytesUploaded, bytesTotal);
            },
            onAfterResponse: (_req, res) => {
                const key = res.getHeader("X-WikINT-File-Key");
                if (key) quarantineKey = key;

                // Capture tus URL once available (after first POST)
                if (upload.url) {
                    options.onTusUrlAvailable?.(upload.url);
                }
            },
            onSuccess: () => {
                if (!quarantineKey) {
                    reject(new Error("Server did not return X-WikINT-File-Key after tus upload"));
                    return;
                }
                onStatusUpdate?.("Processing…");
                onProgress?.(80);
                resolve(quarantineKey);
            },
            onError: (err) => {
                if (signal?.aborted) {
                    reject(new Error("Upload cancelled"));
                } else {
                    reject(err instanceof Error ? err : new Error(String(err)));
                }
            },
        });

        // Provide handle to caller for pause/resume
        options.onTusReady?.({
            pause: () => upload.abort(false), // false = don't send DELETE to server
            resume: () => upload.start(),
            abort: (sendDelete) => upload.abort(sendDelete),
        });

        // Abort via signal
        signal?.addEventListener("abort", () => {
            upload.abort().catch(() => { });
            reject(new Error("Upload cancelled"));
        }, { once: true });

        upload.start();
    });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Upload a file through the pipeline:
 *
 *   Phase 1 (0–5 %):   Client-side SHA-256 computation + dedup check.
 *                        If already processed, returns immediately.
 *   Phase 2 (5–80 %):  For files < 5 MiB: POST /init → XHR PUT → POST /complete.
 *                        For files ≥ 5 MiB: tus 1.0.0 chunked resumable upload.
 *   Phase 3 (80–100 %): SSE stream for background processing (scan + strip + compress).
 */
export async function uploadFile(
    file: File,
    options: UploadFileOptions = {},
): Promise<UploadResult> {
    const { onProgress, signal } = options;

    // ── Phase 1: SHA-256 pre-check (0–5%) (U8: Hash original first) ───────────
    onProgress?.(0);
    _onStatusUpdate(options.onStatusUpdate, "Computing checksum…");

    const sha256 = await sha256File(file, (p) => {
        // Map 0-100% hashing progress to 0-5% total progress
        onProgress?.(Math.round(p * 0.05));
    }, signal);
    onProgress?.(5);

    // Check if this exact file already exists (per-user or global CAS)
    const token = getAccessToken();
    const baseHeaders: Record<string, string> = {
        "X-Client-ID": getClientId(),
    };
    if (token) baseHeaders["Authorization"] = `Bearer ${token}`;

    let existsResp: CheckExistsResponse = { exists: false };
    try {
        const r = await apiRequest("/upload/check-exists", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...baseHeaders },
            body: JSON.stringify({ sha256, size: file.size }),
            signal,
        });
        if (r.ok) {
            existsResp = await r.json();
        } else if (r.status === 401 || r.status === 403) {
            // (U16) Propagate 401/403 to surface re-auth prompt
            throw new ApiError(r.status, "Authentication required");
        }
    } catch (err) {
        if (err instanceof ApiError) throw err;
        // Network errors etc - assume not exists and proceed
    }

    onProgress?.(5);

    if (existsResp.exists && existsResp.file_key) {
        // Fast path: file already exists in clean state — wait for processing SSE
        _onStatusUpdate(options.onStatusUpdate, "File already processed");
        onProgress?.(80);
        const result = await _waitForUploadCompletion(existsResp.file_key, {
            onProgress: (p) => onProgress?.(80 + Math.round(p * 19)),
            onStatusUpdate: options.onStatusUpdate,
            signal,
        });
        onProgress?.(100);
        return {
            file_key: result.file_key,
            size: result.size,
            original_size: result.original_size,
            mime_type: result.mime_type,
            correctedName: result.file_key.split("/").pop() ?? file.name,
            wasCompressed: false,
        };
    }

    // ── Client-side image compression (U8: AFTER hashing original) ───────────
    const { file: fileToUpload, compressed } = await compressImageIfNeeded(file, options.skipCompression);

    // ── Phase 2: Transfer to S3 (5–80%) ──────────────────────────────────────
    let quarantineKey: string;

    if (options.tusUrl) {
        // RESUME: If we have a tusUrl, we must use TUS regardless of current size
        // (the file might have been compressed or is just being resumed).
        _onStatusUpdate(options.onStatusUpdate, "Resuming upload…");
        quarantineKey = await _tusUpload(fileToUpload, options);
    } else if (fileToUpload.size >= PRESIGNED_MULTIPART_THRESHOLD_BYTES) {
        // Extra-large file: direct S3 multipart
        try {
            quarantineKey = await _presignedMultipartUpload(fileToUpload, options);
        } catch (err) {
            if (err instanceof ApiError && err.status === 501) {
                // Fallback to TUS if not enabled on server
                quarantineKey = await _tusUpload(fileToUpload, options);
            } else {
                throw err;
            }
        }
    } else if (fileToUpload.size >= TUS_THRESHOLD_BYTES) {
        // Large file: tus resumable upload
        _onStatusUpdate(options.onStatusUpdate, "Uploading…");
        quarantineKey = await _tusUpload(fileToUpload, options);
    } else {

        // Small file: presigned PUT
        _onStatusUpdate(options.onStatusUpdate, "Uploading…");

        const initResp = await apiRequest("/upload/init", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...baseHeaders },
            body: JSON.stringify({
                filename: fileToUpload.name,
                size: fileToUpload.size,
                mime_type: fileToUpload.type || "application/octet-stream",
            }),
            signal,
        }).then((r) => r.json() as Promise<InitUploadResponse>);

        // PUT directly to S3 — bypasses the API server entirely
        await _xhrPutWithRetry(
            initResp.presigned_url,
            fileToUpload,
            onProgress,
            options.onBytesProgress,
            signal,
        );
        quarantineKey = initResp.quarantine_key;

        onProgress?.(80);
        _onStatusUpdate(options.onStatusUpdate, "Processing…");

        // Notify API that the upload is complete and trigger background processing
        const completeHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            ...baseHeaders,
        };
        if (options.uploadId) completeHeaders["X-Upload-ID"] = options.uploadId;

        await apiRequest("/upload/complete", {
            method: "POST",
            headers: completeHeaders,
            body: JSON.stringify({
                upload_id: initResp.upload_id,
                quarantine_key: initResp.quarantine_key,
            }),
            signal,
        });

        quarantineKey = initResp.quarantine_key;
    }

    // ── Phase 3: SSE stream (80–100%) ─────────────────────────────────────────
    const result = await _waitForUploadCompletion(quarantineKey, {
        onProgress: (p) => onProgress?.(80 + Math.round(p * 19)),
        onStatusUpdate: options.onStatusUpdate,
        signal,
    });

    // Explicitly mark 100% complete (audit review fix: 80 + round(1.0*19) = 99)
    onProgress?.(100);

    return {
        file_key: result.file_key,
        size: result.size,
        original_size: result.original_size,
        mime_type: result.mime_type,
        correctedName: result.file_key.split("/").pop() ?? file.name,
        wasCompressed: compressed,
    };
}

function _onStatusUpdate(
    cb: ((s: string) => void) | undefined,
    msg: string,
): void {
    cb?.(msg);
}

// ── SSE stream reader ─────────────────────────────────────────────────────────

/**
 * Opens an SSE stream to /upload/events/{fileKey} using fetch (not EventSource)
 * so we can send a proper Authorization header.
 */
// Terminal upload failure — should NOT be retried by the SSE reconnection loop (audit fix).
class UploadTerminalError extends Error {
    public readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.name = "UploadTerminalError";
        this.status = status;
    }
}

/** Maximum wall-clock time (ms) to wait for SSE processing before giving up. */
const SSE_TOTAL_TIMEOUT = 5 * 60 * 1000; // 5 minutes

async function _waitForUploadCompletion(
    fileKey: string,
    options: {
        onProgress?: (p: number) => void;
        onStatusUpdate?: (s: string) => void;
        signal?: AbortSignal;
    } = {},
): Promise<NonNullable<UploadEventPayload["result"]>> {
    const { onStatusUpdate, signal } = options;
    let lastEventId = 0;
    let attempts = 0;
    let highWaterMark = 0; // Track highest progress to prevent regression (audit fix)
    const deadline = Date.now() + SSE_TOTAL_TIMEOUT;

    // Wrap onProgress to never report a lower value than previously seen
    const safeOnProgress = options.onProgress
        ? (p: number) => {
              if (p > highWaterMark) {
                  highWaterMark = p;
                  options.onProgress!(p);
              }
          }
        : undefined;

    while (true) {
        // Total timeout guard (audit review fix): prevent indefinite wait
        // when the worker is dead but the SSE endpoint keeps sending pings.
        if (Date.now() > deadline) {
            const fallback = await pollUploadStatus(fileKey);
            if (fallback?.result && fallback.status === "clean") return fallback.result;
            throw new Error("Upload processing timed out. Check upload history for status.");
        }

        try {
            const response = await apiRequest(`/upload/events/${encodeURIComponent(fileKey)}`, {
                headers: {
                    Accept: "text/event-stream",
                    "Cache-Control": "no-cache",
                    ...(lastEventId > 0 ? { "Last-Event-ID": String(lastEventId) } : {}),
                },
                signal,
            });

            if (!response.body) {
                throw new Error("SSE response has no body");
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            let buffer = "";
            let currentEventType = "message";
            let currentData = "";

            const readWithTimeout = async () => {
                return Promise.race([
                    reader.read(),
                    new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) =>
                        setTimeout(() => reject(new Error("SSE Read Timeout")), 30000)
                    )
                ]);
            };

            try {
                while (true) {
                    const { done, value } = await readWithTimeout();
                    
                    // (O2) Connection is active, reset attempts to allow for 
                    // long processing times (e.g. large file scans).
                    attempts = 0;

                    if (done) {
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });

                    const lines = buffer.split(/\r?\n/);
                    buffer = lines.pop() ?? "";

                    for (const line of lines) {
                        if (line === "") {
                            if (currentData !== "") {
                                const result = _handleUploadEvent(
                                    currentEventType,
                                    currentData,
                                    safeOnProgress,
                                    onStatusUpdate,
                                );
                                if (result !== null) return result;
                            }
                            currentEventType = "message";
                            currentData = "";
                        } else if (line.startsWith("event:")) {
                            currentEventType = line.slice(6).trim();
                        } else if (line.startsWith("data:")) {
                            currentData = line.slice(5).trimStart();
                        } else if (line.startsWith("id:")) {
                            lastEventId = parseInt(line.slice(3).trim()) || lastEventId;
                        }
                    }
                }
            } finally {
                reader.cancel().catch(() => { });
            }

            // (O2) Always add a small delay and increment attempts on closure
            // to prevent infinite loop if the server is closing the connection immediately.
            attempts++;
            if (attempts >= 10) throw new Error("SSE reconnection limit reached");
            const delay = Math.min(1000 * 2 ** (attempts - 1), 10_000);
            await _sleep(delay, signal);
        } catch (err) {
            if (signal?.aborted) throw err;
            if (err instanceof UploadTerminalError) throw new ApiError(err.status, err.message);
            if (err instanceof Error && err.message === "SSE reconnection limit reached") throw err;
            
            attempts++;
            if (attempts >= 10) throw err;
            const delay = Math.min(1000 * 2 ** (attempts - 1), 10_000);
            await _sleep(delay, signal);
        }
    }
}

function _handleUploadEvent(
    eventType: string,
    rawData: string,
    onProgress?: (p: number) => void,
    onStatusUpdate?: (s: string) => void,
): NonNullable<UploadEventPayload["result"]> | null {
    if (eventType === "ping" || rawData === "") return null;

    let payload: UploadEventPayload;
    try {
        payload = JSON.parse(rawData) as UploadEventPayload;
    } catch {
        return null;
    }

    if (payload.detail) {
        onStatusUpdate?.(payload.detail);
    }

    // Use structured overall_percent (0.0–1.0) for smooth progress in 80–99 range.
    if (payload.overall_percent != null) {
        // Map 0.0-1.0 from worker to 80-100 range for the caller's formula
        // p is expected to be 0.0-1.0, and the caller does 80 + Math.round(p * 19)
        onProgress?.(payload.overall_percent);
    } else {
        onProgress?.(0.5); // midpoint fallback for older worker versions
    }

    switch (payload.status) {
        case "clean":
            if (!payload.result) throw new Error("Received clean status with no result payload");
            onProgress?.(1.0);
            return payload.result;

        case "malicious":
            throw new UploadTerminalError(
                400,
                payload.detail ?? "File was rejected: potential security threat detected",
            );

        case "failed":
            throw new UploadTerminalError(500, payload.detail ?? "File processing failed");

        default:
            return null;
    }
}

// ── Status polling fallback ───────────────────────────────────────────────────

/**
 * Poll /upload/status/{fileKey} once. Used as a reconnect fallback when SSE
 * is unavailable (e.g. corporate proxies that buffer SSE).
 */
export async function pollUploadStatus(fileKey: string): Promise<UploadEventPayload | null> {
    try {
        const r = await apiRequest(`/upload/status/${encodeURIComponent(fileKey)}`);
        return (await r.json()) as UploadEventPayload;
    } catch {
        return null;
    }
}

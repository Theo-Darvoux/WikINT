import { clearAccessToken, getAccessToken, setAccessToken } from "./auth-tokens";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

type FetchOptions = RequestInit & {
    skipAuth?: boolean;
};

async function refreshToken(): Promise<string | null> {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token as string;
}

let refreshPromise: Promise<string | null> | null = null;

function refreshTokenOnce(): Promise<string | null> {
    if (!refreshPromise) {
        refreshPromise = refreshToken().finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
}

function getClientId(): string {
    if (typeof window === "undefined") return "server-client";
    let clientId = localStorage.getItem("wikint_client_id");
    if (!clientId) {
        clientId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        localStorage.setItem("wikint_client_id", clientId);
    }
    return clientId;
}

export async function apiRequest(
    path: string,
    options: FetchOptions = {},
): Promise<Response> {
    const { skipAuth, ...fetchOptions } = options;
    const headers = new Headers(fetchOptions.headers);

    headers.set("X-Client-ID", getClientId());

    if (!skipAuth) {
        const token = getAccessToken();
        if (token) {
            headers.set("Authorization", `Bearer ${token}`);
        }
    }

    if (!headers.has("Content-Type") && fetchOptions.body && typeof fetchOptions.body === "string") {
        headers.set("Content-Type", "application/json");
    }

    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    let res = await fetch(url, { ...fetchOptions, headers, credentials: "include" });

    if (res.status === 401 && !skipAuth) {
        const newToken = await refreshTokenOnce();
        if (newToken) {
            setAccessToken(newToken);
            headers.set("Authorization", `Bearer ${newToken}`);
            res = await fetch(url, { ...fetchOptions, headers, credentials: "include" });
        } else {
            clearAccessToken();
            throw new ApiError(401, "Session expired");
        }
    }

    if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }));
        let message = body.detail ?? "Unknown error";
        if (Array.isArray(body.detail)) {
            message = body.detail.map((err: Record<string, unknown>) => err.msg || err.detail || JSON.stringify(err)).join(", ");
        }
        throw new ApiError(res.status, message);
    }

    return res;
}

export async function apiFetch<T>(
    path: string,
    options: FetchOptions = {},
): Promise<T> {
    const res = await apiRequest(path, options);
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
}

export async function apiFetchBlob(
    path: string,
    options: FetchOptions = {},
): Promise<Blob> {
    const res = await apiRequest(path, options);
    return res.blob();
}

/**
 * Fetch material file content via a two-step presigned URL flow.
 * Step 1: authenticated call to /inline to get a short-lived presigned URL.
 * Step 2: plain fetch (no Authorization header) to the presigned URL.
 * This avoids the S3 400 caused by forwarding auth headers on same-origin redirects.
 */
export async function fetchMaterialFile(materialId: string): Promise<Response> {
    const { url } = await apiFetch<{ url: string }>(`/materials/${materialId}/inline`);
    const res = await fetch(url);
    if (!res.ok) throw new ApiError(res.status, `Failed to fetch file: ${res.statusText}`);
    return res;
}

export async function fetchMaterialBlob(materialId: string): Promise<Blob> {
    const res = await fetchMaterialFile(materialId);
    return res.blob();
}

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

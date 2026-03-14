import { clearAccessToken, getAccessToken, setAccessToken } from "./auth-tokens";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

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

export async function apiFetch<T>(
    path: string,
    options: FetchOptions = {},
): Promise<T> {
    const { skipAuth, ...fetchOptions } = options;
    const headers = new Headers(fetchOptions.headers);

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
        const newToken = await refreshToken();
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

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
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

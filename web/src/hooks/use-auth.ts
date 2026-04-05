"use client";

import { useCallback } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { setAccessToken, getAccessToken } from "@/lib/auth-tokens";
import { useAuthStore, UserBrief } from "@/lib/stores";
import { broadcastTokenAcquired, performLogout, scheduleRefreshTimer } from "@/lib/auth-sync";

export function useAuth() {
    const { user, isAuthenticated, isLoading, setUser, setLoading } = useAuthStore();

    const requestCode = useCallback(async (email: string) => {
        await apiFetch("/auth/request-code", {
            method: "POST",
            body: JSON.stringify({ email }),
            skipAuth: true,
        });
    }, []);

    const verifyCode = useCallback(async (email: string, code: string) => {
        const data = await apiFetch<{
            access_token: string;
            user: UserBrief;
            is_new_user: boolean;
        }>("/auth/verify-code", {
            method: "POST",
            body: JSON.stringify({ email, code }),
            skipAuth: true,
        });

        setAccessToken(data.access_token);
        setUser(data.user);
        scheduleRefreshTimer(data.access_token);
        broadcastTokenAcquired(data.access_token);
        return data;
    }, [setUser]);

    const verifyMagicLink = useCallback(async (token: string) => {
        const data = await apiFetch<{
            access_token: string;
            user: UserBrief;
            is_new_user: boolean;
        }>("/auth/verify-magic-link", {
            method: "POST",
            body: JSON.stringify({ token }),
            skipAuth: true,
        });

        setAccessToken(data.access_token);
        setUser(data.user);
        scheduleRefreshTimer(data.access_token);
        broadcastTokenAcquired(data.access_token);
        return data;
    }, [setUser]);

    const logout = useCallback(async () => {
        try {
            await apiFetch("/auth/logout", { method: "POST" });
        } catch {
            // ignore
        }
        performLogout();
    }, []);

    const fetchMe = useCallback(async () => {
        setLoading(true);
        try {
            const me = await apiFetch<UserBrief>("/users/me");
            setUser(me);
            const token = getAccessToken();
            if (token) scheduleRefreshTimer(token);
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                performLogout();
            }
        } finally {
            setLoading(false);
        }
    }, [setUser, setLoading]);

    return { user, isAuthenticated, isLoading, requestCode, verifyCode, verifyMagicLink, logout, fetchMe };
}

"use client";

import { useCallback } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { clearAccessToken, setAccessToken } from "@/lib/auth-tokens";
import { useAuthStore, UserBrief } from "@/lib/stores";

export function useAuth() {
    const { user, isAuthenticated, isLoading, setUser, setLoading, logout: storeLogout } = useAuthStore();

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
        return data;
    }, [setUser]);

    const logout = useCallback(async () => {
        try {
            await apiFetch("/auth/logout", { method: "POST" });
        } catch {
            // ignore
        }
        clearAccessToken();
        storeLogout();
    }, [storeLogout]);

    const fetchMe = useCallback(async () => {
        setLoading(true);
        try {
            const me = await apiFetch<UserBrief>("/users/me");
            setUser(me);
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                clearAccessToken();
                storeLogout();
            }
        } finally {
            setLoading(false);
        }
    }, [setUser, setLoading, storeLogout]);

    return { user, isAuthenticated, isLoading, requestCode, verifyCode, logout, fetchMe };
}

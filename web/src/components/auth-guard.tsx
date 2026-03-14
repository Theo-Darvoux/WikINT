"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { getAccessToken } from "@/lib/auth-tokens";

interface AuthGuardProps {
    children: ReactNode;
    requireOnboarded?: boolean;
}

export function AuthGuard({ children, requireOnboarded = false }: AuthGuardProps) {
    const { user, isAuthenticated, isLoading, fetchMe } = useAuth();
    const router = useRouter();

    useEffect(() => {
        const token = getAccessToken();
        if (token && !isAuthenticated && isLoading) {
            fetchMe();
        } else if (!token && isLoading) {
            // No token - stop loading immediately so the redirect to /login fires
            fetchMe(); // This will fail with 401 and clear loading state
        }
    }, [isAuthenticated, isLoading, fetchMe]);

    useEffect(() => {
        if (isLoading) return;

        if (!isAuthenticated) {
            router.replace("/login");
            return;
        }

        if (requireOnboarded && user && !user.onboarded) {
            router.replace("/onboarding");
        }
    }, [isAuthenticated, isLoading, user, router, requireOnboarded]);

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    if (!isAuthenticated) return null;
    if (requireOnboarded && user && !user.onboarded) return null;

    return <>{children}</>;
}

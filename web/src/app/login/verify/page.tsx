"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function MagicLinkVerifier() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { verifyMagicLink, isAuthenticated, user } = useAuth();
    const [error, setError] = useState<string | null>(null);
    const attempted = useRef(false);

    useEffect(() => {
        if (attempted.current) return;
        attempted.current = true;

        const token = searchParams.get("token");

        // Strip token from URL to prevent Referer leakage
        window.history.replaceState({}, "", "/login/verify");

        if (!token) {
            setError("Invalid magic link — no token provided.");
            return;
        }

        verifyMagicLink(token)
            .then((data) => {
                if (data.is_new_user || !data.user.onboarded) {
                    router.replace("/onboarding");
                } else {
                    router.replace("/browse");
                }
            })
            .catch((err) => {
                setError(
                    err instanceof Error
                        ? err.message
                        : "This magic link is invalid or has expired."
                );
            });
    }, [searchParams, verifyMagicLink, router]);

    useEffect(() => {
        if (isAuthenticated && user?.onboarded) {
            router.replace("/browse");
        } else if (isAuthenticated && !user?.onboarded) {
            router.replace("/onboarding");
        }
    }, [isAuthenticated, user, router]);

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background px-4">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <CardTitle className="text-2xl font-bold">WikINT</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 text-center">
                        <p className="text-sm text-destructive">{error}</p>
                        <p className="text-xs text-muted-foreground">
                            The link may have expired or already been used.
                        </p>
                        <Button
                            className="w-full"
                            onClick={() => router.push("/login")}
                        >
                            Back to login
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <CardTitle className="text-2xl font-bold">WikINT</CardTitle>
                </CardHeader>
                <CardContent className="text-center">
                    <p className="text-sm text-muted-foreground">Signing you in...</p>
                </CardContent>
            </Card>
        </div>
    );
}

export default function MagicLinkPage() {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-screen items-center justify-center bg-background px-4">
                    <Card className="w-full max-w-md">
                        <CardHeader className="text-center">
                            <CardTitle className="text-2xl font-bold">WikINT</CardTitle>
                        </CardHeader>
                        <CardContent className="text-center">
                            <p className="text-sm text-muted-foreground">Loading...</p>
                        </CardContent>
                    </Card>
                </div>
            }
        >
            <MagicLinkVerifier />
        </Suspense>
    );
}

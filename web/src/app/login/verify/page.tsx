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
    const [token, setToken] = useState<string | null>(null);
    const [isVerifying, setIsVerifying] = useState(false);
    const attempted = useRef(false);

    useEffect(() => {
        if (attempted.current) return;
        attempted.current = true;

        const t = searchParams.get("token");
        if (t) {
            setToken(t);
            // Strip token from URL to prevent Referer leakage
            window.history.replaceState({}, "", "/login/verify");
        } else if (!isAuthenticated) {
            setError("Invalid magic link — no token provided.");
        }
    }, [searchParams, isAuthenticated]);

    useEffect(() => {
        if (isAuthenticated && user?.onboarded) {
            router.replace("/browse");
        } else if (isAuthenticated && !user?.onboarded) {
            router.replace("/onboarding");
        }
    }, [isAuthenticated, user, router]);

    const handleVerify = async () => {
        if (!token || isVerifying) return;
        setIsVerifying(true);
        try {
            const data = await verifyMagicLink(token);
            if (data.is_new_user || !data.user.onboarded) {
                router.replace("/onboarding");
            } else {
                router.replace("/browse");
            }
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "This magic link is invalid or has expired."
            );
            setIsVerifying(false);
        }
    };

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background px-4">
                <Card className="w-full max-w-md border-destructive/20 shadow-lg">
                    <CardHeader className="text-center">
                        <CardTitle className="text-3xl font-bold tracking-tight">WikINT</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6 text-center">
                        <div className="rounded-lg bg-destructive/10 p-4">
                            <p className="text-sm font-medium text-destructive">{error}</p>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            The link may have expired or already been used by another device.
                        </p>
                        <Button
                            className="w-full py-6 text-lg"
                            variant="outline"
                            onClick={() => router.push("/login")}
                        >
                            Back to Login
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
            <Card className="w-full max-w-md shadow-2xl border-primary/10">
                <CardHeader className="text-center pt-8">
                    <CardTitle className="text-4xl font-black tracking-tighter">WikINT</CardTitle>
                </CardHeader>
                <CardContent className="space-y-8 text-center pb-12 pt-4">
                    <div className="space-y-2">
                        <h2 className="text-xl font-semibold">Verify your sign-in</h2>
                        <p className="text-sm text-muted-foreground px-8">
                            To finish signing in, please click the button below. This extra step helps keep your account secure.
                        </p>
                    </div>
                    
                    <Button 
                        size="lg" 
                        className="w-full h-16 text-xl font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
                        onClick={handleVerify}
                        disabled={isVerifying || !token}
                    >
                        {isVerifying ? (
                            <span className="flex items-center gap-2">
                                <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                Verifying...
                            </span>
                        ) : (
                            "Confirm Sign In"
                        )}
                    </Button>
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

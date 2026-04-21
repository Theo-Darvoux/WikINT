"use client";

import { useState, useEffect, type FormEvent, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { GoogleOAuthProvider, GoogleLogin, CredentialResponse } from "@react-oauth/google";
import { useConfigStore } from "@/lib/stores";

type Step = "email" | "code";

export default function LoginPage() {
    const [step, setStep] = useState<Step>("email");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);
    const { requestCode, verifyCode, verifyGoogleOAuth, isAuthenticated, user } = useAuth();
    const { config } = useConfigStore();
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isAuthenticated && user?.onboarded) {
            router.replace("/browse");
        } else if (isAuthenticated && !user?.onboarded) {
            router.replace("/onboarding");
        }
    }, [isAuthenticated, user, router]);

    // authMethods derived from config
    const authMethods = {
        totp_enabled: config?.totp_enabled ?? true,
        google_enabled: config?.google_enabled ?? false,
        google_client_id: config?.google_client_id ?? null,
    };


    const handleRequestCode = async (e?: FormEvent) => {
        if (e) e.preventDefault();
        setLoading(true);
        try {
            await requestCode(email);
            setStep("code");
            setCode("");
            toast.success("Code sent! Check your email.");
            setTimeout(() => inputRef.current?.focus(), 100);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to send code");
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyCode = async (e: FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const data = await verifyCode(email, code);
            if (data.is_new_user || !data.user.onboarded) {
                router.push("/onboarding");
            } else {
                router.push("/");
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Invalid code");
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
        if (!credentialResponse.credential) return;
        setLoading(true);
        try {
            const data = await verifyGoogleOAuth(credentialResponse.credential);
            if (data.is_new_user || !data.user.onboarded) {
                router.push("/onboarding");
            } else {
                router.push("/");
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Google login failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <CardTitle className="text-2xl font-bold">{config?.site_name || "WikINT"}</CardTitle>
                    <CardDescription>
                        {step === "email"
                            ? (config?.site_description || "Sign in to access course materials")
                            : "Enter the verification code"}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {step === "email" ? (
                        <div className="space-y-6">
                            {authMethods.google_enabled && (
                                <div className="flex flex-col gap-4 items-center">
                                    <div className="w-full flex justify-center">
                                        {authMethods.google_client_id ? (
                                            <GoogleOAuthProvider clientId={authMethods.google_client_id}>
                                                <GoogleLogin
                                                    onSuccess={handleGoogleSuccess}
                                                    onError={() => toast.error("Google login failed")}
                                                    theme="outline"
                                                    size="large"
                                                    width="100%"
                                                    shape="rectangular"
                                                    context="signin"
                                                />
                                            </GoogleOAuthProvider>
                                        ) : (
                                            <div className="h-[44px] w-full bg-muted animate-pulse rounded-md" />
                                        )}
                                    </div>
                                    {authMethods.totp_enabled && (
                                        <div className="relative w-full">
                                            <div className="absolute inset-0 flex items-center">
                                                <span className="w-full border-t" />
                                            </div>
                                            <div className="relative flex justify-center text-xs uppercase">
                                                <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {authMethods.totp_enabled && (
                                <form onSubmit={handleRequestCode} className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="email">Email</Label>
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder="prenom.nom@telecom-sudparis.eu"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            required
                                            autoFocus
                                            disabled={loading}
                                        />
                                    </div>
                                    <Button type="submit" className="w-full" disabled={loading}>
                                        {loading ? "Sending..." : "Send verification code"}
                                    </Button>
                                </form>
                            )}

                            {!authMethods.totp_enabled && !authMethods.google_enabled && (
                                <p className="text-sm text-center text-muted-foreground py-4">
                                    No authentication methods are currently enabled.
                                </p>
                            )}
                        </div>
                    ) : (
                        <form onSubmit={handleVerifyCode} className="space-y-6">
                            <div className="space-y-3">
                                <div className="flex justify-between items-center px-1">
                                    <Label htmlFor="code" className="block">Verification code</Label>
                                    <button 
                                        type="button" 
                                        className="text-xs text-primary hover:underline font-medium"
                                        onClick={() => handleRequestCode()}
                                        disabled={loading}
                                    >
                                        Resend code
                                    </button>
                                </div>
                                <div className="relative cursor-text" onClick={() => inputRef.current?.focus()}>
                                    {/* Invisible actual input - accessible to screen readers */}
                                    <input
                                        ref={inputRef}
                                        id="code"
                                        type="text"
                                        maxLength={8}
                                        value={code}
                                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                                        className="absolute inset-0 opacity-0 cursor-text"
                                        autoFocus
                                        required
                                        autoComplete="one-time-code"
                                        aria-label="Code de vérification à 8 caractères"
                                        disabled={loading}
                                    />
                                    {/* Visual representation - hidden from screen readers */}
                                    <div className="flex justify-between gap-2" aria-hidden="true">
                                        {[...Array(8)].map((_, i) => (
                                            <div
                                                key={i}
                                                className={`
                                                    flex h-12 w-10 items-center justify-center rounded-md border-2 text-lg font-bold transition-all
                                                    ${code.length === i && !loading ? "border-primary ring-2 ring-primary/20 scale-105" : "border-muted"}
                                                    ${code[i] ? "border-primary/50 bg-primary/5" : ""}
                                                `}
                                            >
                                                {code[i] || ""}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <p className="text-center text-xs text-muted-foreground">
                                    Check your email for a sign-in link or enter the 8-character code.
                                    <br/>
                                    <span className="opacity-80">Valid for 10 minutes. Maximum 5 attempts.</span>
                                </p>
                            </div>
                            <Button type="submit" className="w-full" disabled={loading}>
                                {loading ? "Verifying..." : "Verify"}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                className="w-full"
                                onClick={() => window.open("https://cerbere.imt.fr/zimbra", "_blank")}
                                disabled={loading}
                            >
                                Open email box (Zimbra)
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                className="w-full"
                                onClick={() => {
                                    setStep("email");
                                    setCode("");
                                }}
                                disabled={loading}
                            >
                                Use a different email
                            </Button>
                        </form>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

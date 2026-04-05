"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const ACADEMIC_YEARS = ["1A", "2A", "3A+"] as const;

export default function OnboardingPage() {
    const [displayName, setDisplayName] = useState("");
    const [academicYear, setAcademicYear] = useState<string>("");
    const [gdprConsent, setGdprConsent] = useState(false);
    const [loading, setLoading] = useState(false);
    const { fetchMe } = useAuth();
    const router = useRouter();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!gdprConsent) {
            toast.error("You must accept the GDPR terms to continue");
            return;
        }
        setLoading(true);
        try {
            await apiFetch("/users/me/onboard", {
                method: "POST",
                body: JSON.stringify({
                    display_name: displayName,
                    academic_year: academicYear,
                    gdpr_consent: gdprConsent,
                }),
            });
            await fetchMe();
            router.push("/");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Onboarding failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <CardTitle className="text-2xl font-bold">Welcome to WikINT!</CardTitle>
                    <CardDescription>Set up your profile to get started</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="displayName">Display name</Label>
                            <Input
                                id="displayName"
                                type="text"
                                placeholder="Your name"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                required
                                autoFocus
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="academicYear">Academic year</Label>
                            <div className="flex gap-2">
                                {ACADEMIC_YEARS.map((year) => (
                                    <Button
                                        key={year}
                                        type="button"
                                        variant={academicYear === year ? "default" : "outline"}
                                        onClick={() => setAcademicYear(year)}
                                        className="flex-1"
                                    >
                                        {year}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-start gap-2">
                            <input
                                id="gdpr"
                                type="checkbox"
                                checked={gdprConsent}
                                onChange={(e) => setGdprConsent(e.target.checked)}
                                className="mt-1"
                            />
                            <Label htmlFor="gdpr" className="text-sm text-muted-foreground">
                                I agree to the processing of my personal data (email, display name) for the
                                purpose of using WikINT. I understand that materials I upload become the
                                property of WikINT. I can request deletion of my personal data at any time.
                                See our{" "}
                                <a href="/privacy" className="underline hover:text-foreground">
                                    privacy policy
                                </a>.
                            </Label>
                        </div>

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={loading || !academicYear || !displayName || !gdprConsent}
                        >
                            {loading ? "Setting up..." : "Get started"}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}

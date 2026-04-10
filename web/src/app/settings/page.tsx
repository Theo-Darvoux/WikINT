"use client";

import { useState } from "react";
import { Download, Trash2, Shield, AlertTriangle, Sun, Moon, Zap, Check, X } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { apiFetch } from "@/lib/api-client";
import { performLogout } from "@/lib/auth-sync";
import { toast } from "sonner";
import { useAuthStore } from "@/lib/stores";

export default function SettingsPage() {
    const [exporting, setExporting] = useState(false);
    const { show } = useConfirmDialog();
    const { theme, setTheme } = useTheme();
    const { user, setUser } = useAuthStore();
    const [updating, setUpdating] = useState(false);

    const isAdmin = user?.role === "bureau" || user?.role === "vieux";

    const handleToggleAutoApprove = async () => {
        if (!user) return;
        setUpdating(true);
        const newValue = !user.auto_approve;
        try {
            const updated = await apiFetch<any>("/users/me", {
                method: "PATCH",
                body: JSON.stringify({ auto_approve: newValue }),
            });
            setUser({ ...user, auto_approve: updated.auto_approve });
            toast.success(newValue ? "Auto-approbation activée" : "Auto-approbation désactivée");
        } catch {
            toast.error("Échec de la mise à jour");
        } finally {
            setUpdating(false);
        }
    };

    const handleExport = async () => {
        setExporting(true);
        try {
            const data = await apiFetch<Record<string, unknown>>("/users/me/data-export");
            const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "my-data-export.json";
            a.click();
            URL.revokeObjectURL(url);
            toast.success("Data exported successfully");
        } catch {
            toast.error("Failed to export data");
        } finally {
            setExporting(false);
        }
    };

    const handleDeleteAccount = () => {
        show(
            "Delete your account?",
            "Your account will be deactivated and personal data anonymized immediately. All personal data will be permanently deleted after 30 days. Contributed materials remain on the platform.",
            async () => {
                try {
                    await apiFetch("/users/me", { method: "DELETE" });
                    performLogout();
                    toast.success("Account deactivated. Data will be deleted in 30 days.");
                    window.location.href = "/login";
                } catch {
                    toast.error("Failed to delete account");
                }
            }
        );
    };

    return (
        <div className="mx-auto max-w-2xl space-y-6 p-6">
            <div className="flex items-center gap-3">
                <Shield className="h-6 w-6 text-primary" />
                <h1 className="text-2xl font-bold">Privacy & Settings</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                        Appearance
                    </CardTitle>
                    <CardDescription>
                        Switch between light and dark mode.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button
                        variant="outline"
                        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                    >
                        {theme === "dark" ? (
                            <><Sun className="mr-2 h-4 w-4" /> Switch to light mode</>
                        ) : (
                            <><Moon className="mr-2 h-4 w-4" /> Switch to dark mode</>
                        )}
                    </Button>
                </CardContent>
            </Card>

            {isAdmin && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Zap className="h-4 w-4 text-amber-500" />
                            Contributions
                        </CardTitle>
                        <CardDescription>
                            Gérez comment vos modifications sont publiées sur la plateforme.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                            <div className="space-y-0.5">
                                <p className="text-sm font-medium">Auto-approbation</p>
                                <p className="text-xs text-muted-foreground mr-8">
                                    Vos modifications sont publiées immédiatement sans passer par une contribution (PR) en attente.
                                </p>
                            </div>
                            <Button
                                variant={user?.auto_approve ? "default" : "outline"}
                                size="sm"
                                onClick={handleToggleAutoApprove}
                                disabled={updating}
                                className="shrink-0 gap-2"
                            >
                                {user?.auto_approve ? (
                                    <><Check className="h-4 w-4" /> Activée</>
                                ) : (
                                    <><X className="h-4 w-4" /> Désactivée</>
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Download className="h-4 w-4" />
                        Export your data
                    </CardTitle>
                    <CardDescription>
                        Download a JSON archive of all your personal data including your profile,
                        contributions, annotations, votes, comments, and reports.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button
                        variant="outline"
                        onClick={handleExport}
                        disabled={exporting}
                    >
                        {exporting ? "Preparing export..." : "Download my data"}
                    </Button>
                </CardContent>
            </Card>

            <Card className="border-destructive/30">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base text-destructive">
                        <Trash2 className="h-4 w-4" />
                        Delete account
                    </CardTitle>
                    <CardDescription>
                        Permanently delete your account and all associated data. This action cannot
                        be undone.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-start gap-3 rounded-md bg-destructive/5 p-3">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                        <div className="space-y-1 text-sm">
                            <p>Your account will be immediately deactivated and your personal data anonymized.</p>
                            <p className="text-muted-foreground">
                                Your personal data (name, email, bio) will be permanently deleted. Contributed materials remain on the
                                platform in anonymized form as per the content license in our{" "}
                                <a href="/privacy" className="underline hover:text-foreground">
                                    privacy policy
                                </a>.
                            </p>
                        </div>
                    </div>
                    <Button
                        variant="destructive"
                        className="mt-3"
                        onClick={handleDeleteAccount}
                    >
                        Delete my account
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

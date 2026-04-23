"use client";

import { useState, useEffect } from "react";
import { Mail, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

interface AuthConfig {
    smtp_host: string | null;
    smtp_ip: string | null;
    smtp_port: number | null;
    smtp_user: string | null;
    smtp_password: string | null;
    smtp_from: string | null;
    smtp_use_tls: boolean;
}

interface EmailConfigTabProps {
    config: AuthConfig;
    saving: boolean;
    patchConfig: (patch: Partial<AuthConfig>) => Promise<void>;
}

export function EmailConfigTab({ config, saving, patchConfig }: EmailConfigTabProps) {
    const [emailForm, setEmailForm] = useState<Partial<AuthConfig>>({});
    const [isEmailModified, setIsEmailModified] = useState(false);
    const [testEmail, setTestEmail] = useState("");
    const [sendingTest, setSendingTest] = useState(false);

    useEffect(() => {
        setEmailForm({
            smtp_host: config.smtp_host,
            smtp_ip: config.smtp_ip,
            smtp_port: config.smtp_port,
            smtp_user: config.smtp_user,
            smtp_password: config.smtp_password,
            smtp_from: config.smtp_from,
            smtp_use_tls: config.smtp_use_tls,
        });
        setIsEmailModified(false);
    }, [config]);

    const handleSave = async () => {
        await patchConfig(emailForm);
        toast.success("Email configuration updated");
        setIsEmailModified(false);
    };

    const handleDiscard = () => {
        setEmailForm({
            smtp_host: config.smtp_host,
            smtp_ip: config.smtp_ip,
            smtp_port: config.smtp_port,
            smtp_user: config.smtp_user,
            smtp_password: config.smtp_password,
            smtp_from: config.smtp_from,
            smtp_use_tls: config.smtp_use_tls,
        });
        setIsEmailModified(false);
    };

    const handleSendTestEmail = async () => {
        if (!testEmail) return;
        setSendingTest(true);
        try {
            await apiFetch("/admin/auth-config/test-email", {
                method: "POST",
                body: JSON.stringify({ email: testEmail }),
            });
            toast.success(`Test email sent to ${testEmail}`);
        } catch (err: any) {
            const message = err?.message || "Failed to send test email. Check your SMTP settings.";
            toast.error(message);
        } finally {
            setSendingTest(false);
        }
    };

    return (
        <TabsContent value="email" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <p className="text-sm text-muted-foreground">
                Configure SMTP settings to enable email notifications and verification codes.
            </p>

            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Mail className="h-5 w-5 text-primary" />
                        <CardTitle className="text-base">SMTP Configuration</CardTitle>
                    </div>
                    <CardDescription>
                        These settings are used for all outgoing emails. If left empty, the platform defaults to environment variables.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="smtp-host">SMTP Host</Label>
                            <Input
                                id="smtp-host"
                                placeholder="smtp.gmail.com"
                                value={emailForm.smtp_host ?? config.smtp_host ?? ""}
                                onChange={(e) => {
                                    setEmailForm(prev => ({ ...prev, smtp_host: e.target.value }));
                                    setIsEmailModified(true);
                                }}
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="smtp-ip">SMTP IP Address (Optional Override)</Label>
                            <Input
                                id="smtp-ip"
                                placeholder="10.0.0.5"
                                value={emailForm.smtp_ip ?? config.smtp_ip ?? ""}
                                onChange={(e) => {
                                    setEmailForm(prev => ({ ...prev, smtp_ip: e.target.value }));
                                    setIsEmailModified(true);
                                }}
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="smtp-port">SMTP Port</Label>
                            <Input
                                id="smtp-port"
                                type="number"
                                placeholder="587"
                                value={emailForm.smtp_port ?? config.smtp_port ?? ""}
                                onChange={(e) => {
                                    setEmailForm(prev => ({ ...prev, smtp_port: parseInt(e.target.value) || null }));
                                    setIsEmailModified(true);
                                }}
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="smtp-user">SMTP User</Label>
                            <Input
                                id="smtp-user"
                                placeholder="user@example.com"
                                value={emailForm.smtp_user ?? config.smtp_user ?? ""}
                                onChange={(e) => {
                                    setEmailForm(prev => ({ ...prev, smtp_user: e.target.value }));
                                    setIsEmailModified(true);
                                }}
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="smtp-password">SMTP Password</Label>
                            <Input
                                id="smtp-password"
                                type="password"
                                placeholder="••••••••••••"
                                value={emailForm.smtp_password ?? config.smtp_password ?? ""}
                                onChange={(e) => {
                                    setEmailForm(prev => ({ ...prev, smtp_password: e.target.value }));
                                    setIsEmailModified(true);
                                }}
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="smtp-from">From Email Address</Label>
                            <Input
                                id="smtp-from"
                                placeholder="WikINT <noreply@wikint.com>"
                                value={emailForm.smtp_from ?? config.smtp_from ?? ""}
                                onChange={(e) => {
                                    setEmailForm(prev => ({ ...prev, smtp_from: e.target.value }));
                                    setIsEmailModified(true);
                                }}
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-2 flex flex-col justify-end">
                            <div className="flex items-center gap-2 pb-2">
                                <Switch
                                    id="smtp-tls"
                                    checked={emailForm.smtp_use_tls ?? config.smtp_use_tls}
                                    onCheckedChange={(val) => {
                                        setEmailForm(prev => ({ ...prev, smtp_use_tls: val }));
                                        setIsEmailModified(true);
                                    }}
                                />
                                <Label htmlFor="smtp-tls">Use TLS / STARTTLS</Label>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end pt-4 border-t gap-3">
                        {isEmailModified && (
                            <Button variant="outline" onClick={handleDiscard}>
                                Discard Changes
                            </Button>
                        )}
                        <Button
                            disabled={saving || !isEmailModified}
                            onClick={handleSave}
                        >
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Email Settings
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-primary/20 bg-primary/5">
                <CardHeader>
                    <CardTitle className="text-base">Test Connection</CardTitle>
                    <CardDescription>
                        Send a test email to verify your SMTP settings. Save your changes before testing.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-2">
                        <Input
                            placeholder="your-email@example.com"
                            value={testEmail}
                            onChange={(e) => setTestEmail(e.target.value)}
                            className="max-w-[300px] h-9"
                        />
                        <Button
                            variant="secondary"
                            disabled={sendingTest || !testEmail}
                            onClick={handleSendTestEmail}
                            className="h-9"
                        >
                            {sendingTest ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Mail className="h-4 w-4 mr-2" />
                            )}
                            Send Test Email
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </TabsContent>
    );
}

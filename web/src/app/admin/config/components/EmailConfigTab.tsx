"use client";

import { useState, useEffect } from "react";
import { Mail, Loader2, Save, Send } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

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

function ToggleRow({
    label,
    description,
    checked,
    disabled,
    onToggle,
    icon: Icon,
}: {
    label: string;
    description: string;
    checked: boolean;
    disabled?: boolean;
    onToggle: () => void;
    icon: React.ElementType;
}) {
    return (
        <div className="flex items-start justify-between gap-4 py-4">
            <div className="flex gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div>
                    <p className="font-medium text-sm leading-none">{label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{description}</p>
                </div>
            </div>
            <Switch
                checked={checked}
                disabled={disabled}
                onCheckedChange={onToggle}
            />
        </div>
    );
}

export function EmailConfigTab({ config, saving, patchConfig }: EmailConfigTabProps) {
    const t = useTranslations("Admin.Config.Email");
    const [emailForm, setEmailForm] = useState<Partial<AuthConfig>>({});
    const [isEmailModified, setIsEmailModified] = useState(false);
    const [testEmail, setTestEmail] = useState("");
    const [testingEmail, setTestingEmail] = useState(false);

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
        toast.success(t("success"));
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

    const handleTestEmail = async () => {
        if (!testEmail.trim()) return;
        setTestingEmail(true);
        try {
            await apiFetch("/admin/auth-config/test-email", {
                method: "POST",
                body: JSON.stringify({ email: testEmail }),
            });
            toast.success(t("test.success", { email: testEmail }));
        } catch {
            toast.error(t("test.error"));
        } finally {
            setTestingEmail(false);
        }
    };

    return (
        <TabsContent value="email" className="mt-6 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Mail className="h-5 w-5 text-primary" />
                        {t("title")}
                    </CardTitle>
                    <CardDescription>
                        {t("descriptionCard")}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="smtp_host">{t("host")}</Label>
                            <Input
                                id="smtp_host"
                                placeholder={t("placeholders.host")}
                                value={emailForm.smtp_host || ""}
                                onChange={(e) => {
                                    setEmailForm((prev) => ({ ...prev, smtp_host: e.target.value }));
                                    setIsEmailModified(true);
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="smtp_ip">{t("ip")}</Label>
                            <Input
                                id="smtp_ip"
                                placeholder={t("placeholders.ip", { defaultValue: "1.2.3.4" })}
                                value={emailForm.smtp_ip || ""}
                                onChange={(e) => {
                                    setEmailForm((prev) => ({ ...prev, smtp_ip: e.target.value }));
                                    setIsEmailModified(true);
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="smtp_port">{t("port")}</Label>
                            <Input
                                id="smtp_port"
                                type="number"
                                placeholder={t("placeholders.port")}
                                value={emailForm.smtp_port ?? ""}
                                onChange={(e) => {
                                    setEmailForm((prev) => ({ ...prev, smtp_port: parseInt(e.target.value) || 0 }));
                                    setIsEmailModified(true);
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="smtp_user">{t("user")}</Label>
                            <Input
                                id="smtp_user"
                                placeholder={t("placeholders.user")}
                                value={emailForm.smtp_user || ""}
                                onChange={(e) => {
                                    setEmailForm((prev) => ({ ...prev, smtp_user: e.target.value }));
                                    setIsEmailModified(true);
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="smtp_password">{t("password")}</Label>
                            <Input
                                id="smtp_password"
                                type="password"
                                placeholder={t("placeholders.password")}
                                autoComplete="off"
                                value={emailForm.smtp_password || ""}
                                onChange={(e) => {
                                    setEmailForm((prev) => ({ ...prev, smtp_password: e.target.value }));
                                    setIsEmailModified(true);
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="smtp_from">{t("from")}</Label>
                            <Input
                                id="smtp_from"
                                placeholder={t("placeholders.from")}
                                value={emailForm.smtp_from || ""}
                                onChange={(e) => {
                                    setEmailForm((prev) => ({ ...prev, smtp_from: e.target.value }));
                                    setIsEmailModified(true);
                                }}
                            />
                        </div>
                    </div>

                    <ToggleRow
                        icon={Mail}
                        label={t("tls")}
                        description={t("description")}
                        checked={emailForm.smtp_use_tls ?? config.smtp_use_tls}
                        onToggle={() => {
                            setEmailForm((prev) => ({
                                ...prev,
                                smtp_use_tls: !prev.smtp_use_tls,
                            }));
                            setIsEmailModified(true);
                        }}
                    />
                    
                    <div className="flex justify-end gap-3 pt-4 border-t">
                        {isEmailModified && (
                            <Button variant="outline" onClick={handleDiscard}>
                                {t("discard")}
                            </Button>
                        )}
                        <Button 
                            onClick={handleSave}
                            disabled={saving || (!isEmailModified && !!config)}
                            className="gap-2"
                        >
                            {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4" />
                            )}
                            {t("save")}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <Send className="h-4 w-4 text-muted-foreground" />
                        {t("test.title")}
                    </CardTitle>
                    <CardDescription>
                        {t("test.description")}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-2 max-w-md">
                        <Input
                            placeholder={t("test.placeholder")}
                            value={testEmail}
                            onChange={(e) => setTestEmail(e.target.value)}
                        />
                        <Button
                            variant="outline"
                            onClick={handleTestEmail}
                            disabled={!testEmail || testingEmail}
                        >
                            {testingEmail ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                t("test.button")
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </TabsContent>
    );
}

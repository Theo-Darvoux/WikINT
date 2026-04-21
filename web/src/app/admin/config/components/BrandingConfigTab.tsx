"use client";

import { useState, useEffect } from "react";
import { Palette, Layout, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useConfigStore } from "@/lib/stores";

interface AuthConfig {
    site_name: string;
    site_description: string;
    site_logo_url: string | null;
    site_favicon_url: string | null;
    primary_color: string;
    footer_text: string;
    organization_url: string | null;
}

interface BrandingConfigTabProps {
    config: AuthConfig;
    saving: boolean;
    patchConfig: (patch: Partial<AuthConfig>) => Promise<void>;
}

export function BrandingConfigTab({ config, saving, patchConfig }: BrandingConfigTabProps) {
    const [brandingForm, setBrandingForm] = useState<Partial<AuthConfig>>({});
    const [isBrandingModified, setIsBrandingModified] = useState(false);
    const { updateConfig: updateGlobalConfig } = useConfigStore();

    useEffect(() => {
        setBrandingForm({
            site_name: config.site_name,
            site_description: config.site_description,
            site_logo_url: config.site_logo_url,
            site_favicon_url: config.site_favicon_url,
            primary_color: config.primary_color,
            footer_text: config.footer_text,
            organization_url: config.organization_url,
        });
        setIsBrandingModified(false);
    }, [config]);

    const handleSave = async () => {
        await patchConfig(brandingForm);
        toast.success("Branding updated");
        setIsBrandingModified(false);
    };

    const handleDiscard = () => {
        setBrandingForm({
            site_name: config.site_name,
            site_description: config.site_description,
            site_logo_url: config.site_logo_url,
            site_favicon_url: config.site_favicon_url,
            primary_color: config.primary_color,
            footer_text: config.footer_text,
            organization_url: config.organization_url,
        });
        setIsBrandingModified(false);
        // Revert global config preview
        updateGlobalConfig({
            site_name: config.site_name,
            primary_color: config.primary_color,
        });
    };

    return (
        <TabsContent value="branding" className="mt-6 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Palette className="h-5 w-5 text-primary" />
                        Visual Identity
                    </CardTitle>
                    <CardDescription>
                        Customize the appearance and identity of your instance.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="site_name">Site Name</Label>
                            <Input
                                id="site_name"
                                placeholder="WikINT"
                                value={brandingForm.site_name || ""}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setBrandingForm(prev => ({ ...prev, site_name: val }));
                                    setIsBrandingModified(true);
                                    updateGlobalConfig({ site_name: val });
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="primary_color">Primary Color</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="primary_color"
                                    type="color"
                                    value={brandingForm.primary_color || "#3b82f6"}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setBrandingForm(prev => ({ ...prev, primary_color: val }));
                                        setIsBrandingModified(true);
                                        updateGlobalConfig({ primary_color: val });
                                    }}
                                    className="w-12 h-9 p-1"
                                />
                                <Input
                                    type="text"
                                    value={brandingForm.primary_color || ""}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setBrandingForm(prev => ({ ...prev, primary_color: val }));
                                        setIsBrandingModified(true);
                                        updateGlobalConfig({ primary_color: val });
                                    }}
                                    className="flex-1 font-mono uppercase"
                                    placeholder="#3B82F6"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="site_description">Site Description</Label>
                        <Input
                            id="site_description"
                            placeholder="Wiki for SudParis Intelligence"
                            value={brandingForm.site_description || ""}
                            onChange={(e) => {
                                setBrandingForm(prev => ({ ...prev, site_description: e.target.value }));
                                setIsBrandingModified(true);
                            }}
                        />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="site_logo_url">Logo URL</Label>
                            <Input
                                id="site_logo_url"
                                placeholder="https://example.com/logo.png"
                                value={brandingForm.site_logo_url || ""}
                                onChange={(e) => {
                                    setBrandingForm(prev => ({ ...prev, site_logo_url: e.target.value }));
                                    setIsBrandingModified(true);
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="site_favicon_url">Favicon URL</Label>
                            <Input
                                id="site_favicon_url"
                                placeholder="https://example.com/favicon.ico"
                                value={brandingForm.site_favicon_url || ""}
                                onChange={(e) => {
                                    setBrandingForm(prev => ({ ...prev, site_favicon_url: e.target.value }));
                                    setIsBrandingModified(true);
                                }}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Layout className="h-5 w-5 text-primary" />
                        Footer & Links
                    </CardTitle>
                    <CardDescription>
                        Configure the footer content and external links.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="footer_text">Footer Copyright/Text</Label>
                            <Input
                                id="footer_text"
                                placeholder="© 2024 WikINT"
                                value={brandingForm.footer_text || ""}
                                onChange={(e) => {
                                    setBrandingForm(prev => ({ ...prev, footer_text: e.target.value }));
                                    setIsBrandingModified(true);
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="organization_url">Organization URL</Label>
                            <Input
                                id="organization_url"
                                placeholder="https://www.example.com"
                                value={brandingForm.organization_url || ""}
                                onChange={(e) => {
                                    setBrandingForm(prev => ({ ...prev, organization_url: e.target.value }));
                                    setIsBrandingModified(true);
                                }}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-end p-6 border-t bg-muted/20 gap-3">
                {isBrandingModified && (
                    <Button variant="outline" onClick={handleDiscard}>
                        Discard Changes
                    </Button>
                )}
                <Button 
                    disabled={saving || !isBrandingModified} 
                    onClick={handleSave}
                >
                    {saving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <Save className="mr-2 h-4 w-4" />
                    )}
                    Save Branding Changes
                </Button>
            </div>
        </TabsContent>
    );
}

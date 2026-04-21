"use client";

import { useState, useEffect } from "react";
import { Database, Cloud, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

interface AuthConfig {
    s3_endpoint: string | null;
    s3_access_key: string | null;
    s3_secret_key: string | null;
    s3_bucket: string | null;
    s3_public_endpoint: string | null;
    s3_region: string | null;
    s3_use_ssl: boolean;
    max_storage_gb: number | null;
}

interface StorageConfigTabProps {
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

export function StorageConfigTab({ config, saving, patchConfig }: StorageConfigTabProps) {
    const [storageForm, setStorageForm] = useState<Partial<AuthConfig>>({});
    const [isStorageModified, setIsStorageModified] = useState(false);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStorageForm({
            s3_endpoint: config.s3_endpoint,
            s3_access_key: config.s3_access_key,
            s3_secret_key: config.s3_secret_key,
            s3_bucket: config.s3_bucket,
            s3_public_endpoint: config.s3_public_endpoint,
            s3_region: config.s3_region,
            s3_use_ssl: config.s3_use_ssl,
            max_storage_gb: config.max_storage_gb,
        });
        setIsStorageModified(false);
    }, [config]);

    const handleSave = async () => {
        await patchConfig(storageForm);
        toast.success("Storage configuration updated");
        setIsStorageModified(false);
    };

    const handleDiscard = () => {
        setStorageForm({
            s3_endpoint: config.s3_endpoint,
            s3_access_key: config.s3_access_key,
            s3_secret_key: config.s3_secret_key,
            s3_bucket: config.s3_bucket,
            s3_public_endpoint: config.s3_public_endpoint,
            s3_region: config.s3_region,
            s3_use_ssl: config.s3_use_ssl,
            max_storage_gb: config.max_storage_gb,
        });
        setIsStorageModified(false);
    };

    return (
        <TabsContent value="storage" className="mt-6 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Database className="h-5 w-5 text-primary" />
                        S3 Storage Configuration
                    </CardTitle>
                    <CardDescription>
                        Configure where files are stored. Supports AWS S3, Cloudflare R2, MinIO, etc.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="s3_endpoint">S3 Endpoint</Label>
                            <Input
                                id="s3_endpoint"
                                placeholder="e.g. s3.amazonaws.com"
                                value={storageForm.s3_endpoint || ""}
                                onChange={(e) => {
                                    setStorageForm((prev) => ({ ...prev, s3_endpoint: e.target.value }));
                                    setIsStorageModified(true);
                                }}
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Do not include http:// or https://
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="s3_region">Region</Label>
                            <Input
                                id="s3_region"
                                placeholder="e.g. us-east-1"
                                value={storageForm.s3_region || ""}
                                onChange={(e) => {
                                    setStorageForm((prev) => ({ ...prev, s3_region: e.target.value }));
                                    setIsStorageModified(true);
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="s3_bucket">Bucket Name</Label>
                            <Input
                                id="s3_bucket"
                                placeholder="my-bucket"
                                value={storageForm.s3_bucket || ""}
                                onChange={(e) => {
                                    setStorageForm((prev) => ({ ...prev, s3_bucket: e.target.value }));
                                    setIsStorageModified(true);
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="s3_public_endpoint">Public Endpoint (Optional)</Label>
                            <Input
                                id="s3_public_endpoint"
                                placeholder="e.g. my-cdn.example.com"
                                value={storageForm.s3_public_endpoint || ""}
                                onChange={(e) => {
                                    setStorageForm((prev) => ({ ...prev, s3_public_endpoint: e.target.value }));
                                    setIsStorageModified(true);
                                }}
                            />
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="s3_access_key">Access Key</Label>
                            <Input
                                id="s3_access_key"
                                type="password"
                                autoComplete="off"
                                value={storageForm.s3_access_key || ""}
                                onChange={(e) => {
                                    setStorageForm((prev) => ({ ...prev, s3_access_key: e.target.value }));
                                    setIsStorageModified(true);
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="s3_secret_key">Secret Key</Label>
                            <Input
                                id="s3_secret_key"
                                type="password"
                                autoComplete="off"
                                value={storageForm.s3_secret_key || ""}
                                onChange={(e) => {
                                    setStorageForm((prev) => ({ ...prev, s3_secret_key: e.target.value }));
                                    setIsStorageModified(true);
                                }}
                            />
                        </div>
                    </div>
                    
                    <div className="pt-4 border-t space-y-4">
                        <div className="space-y-2 max-w-xs">
                            <Label htmlFor="max_storage_gb">Global Storage Limit (GB)</Label>
                            <div className="flex items-center gap-3">
                                <Input
                                    id="max_storage_gb"
                                    type="number"
                                    placeholder="e.g. 10"
                                    value={storageForm.max_storage_gb ?? ""}
                                    onChange={(e) => {
                                        const val = e.target.value === "" ? null : parseInt(e.target.value);
                                        setStorageForm((prev) => ({ ...prev, max_storage_gb: val }));
                                        setIsStorageModified(true);
                                    }}
                                />
                                <span className="text-sm font-bold text-muted-foreground whitespace-nowrap">GB</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                                Prevents new uploads when total storage usage exceeds this value. 
                                Set to 0 or leave empty for no limit.
                            </p>
                        </div>

                        <ToggleRow
                            icon={Cloud}
                            label="Use SSL"
                            description="Whether to use HTTPS for S3 operations."
                            checked={storageForm.s3_use_ssl ?? true}
                            onToggle={() => {
                                setStorageForm((prev) => ({
                                    ...prev,
                                    s3_use_ssl: !prev.s3_use_ssl,
                                }));
                                setIsStorageModified(true);
                            }}
                        />
                        
                        <div className="flex justify-end gap-3">
                            {isStorageModified && (
                                <Button variant="outline" onClick={handleDiscard}>
                                    Discard Changes
                                </Button>
                            )}
                            <Button 
                                onClick={handleSave}
                                disabled={saving || (!isStorageModified && !!config)}
                                className="gap-2"
                            >
                                {saving ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Save className="h-4 w-4" />
                                )}
                                Save Storage Settings
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </TabsContent>
    );
}

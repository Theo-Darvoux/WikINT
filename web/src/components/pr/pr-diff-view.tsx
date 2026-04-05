"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

export function PRDiffView({ prId, payload }: { prId: string, payload: Record<string, unknown> }) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);

    useEffect(() => {
        if (payload.file_key) {
            Promise.resolve().then(() => setLoadingPreview(true));
            apiFetch<{ url: string }>(`/pull-requests/${prId}/preview`)
                .then(res => setPreviewUrl(res.url))
                .catch(() => { /* mute error */ })
                .finally(() => setLoadingPreview(false));
        }
    }, [prId, payload.file_key]);

    // Format the payload into a list of changed properties
    const renderPayloadChanges = () => {
        const skipKeys = ["pr_type", "file_key"];
        return Object.entries(payload)
            .filter(([k, v]) => !skipKeys.includes(k) && v !== null && v !== undefined)
            .map(([k, v]) => (
                <div key={k} className="flex flex-col sm:flex-row gap-2 sm:gap-4 py-2 border-b last:border-0">
                    <span className="font-mono text-sm text-muted-foreground w-1/3 break-all">{k}</span>
                    <span className="font-mono text-sm break-all">
                        {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </span>
                </div>
            ));
    };

    return (
        <div className="space-y-4">
            <div className="bg-card text-card-foreground rounded-lg overflow-hidden">
                {renderPayloadChanges()}
            </div>

            {Boolean(payload.file_key) && (
                <div className="mt-4 p-4 bg-muted/30 border rounded-lg flex items-center justify-between">
                    <span className="text-sm font-medium">Included File Update</span>
                    {loadingPreview ? (
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    ) : previewUrl ? (
                        <Button variant="outline" size="sm" asChild>
                            <a href={previewUrl} target="_blank" rel="noreferrer">
                                <Download className="w-4 h-4 mr-2" />
                                Preview File
                            </a>
                        </Button>
                    ) : (
                        <span className="text-sm text-muted-foreground">Preview unavailable</span>
                    )}
                </div>
            )}
        </div>
    );
}

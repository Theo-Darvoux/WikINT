"use client";

import { useEffect, useState } from "react";

interface MarkdownViewerProps {
    fileKey: string;
    materialId: string;
}

export function MarkdownViewer({ materialId }: MarkdownViewerProps) {
    const [content, setContent] = useState<string>("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchContent = async () => {
            try {
                const response = await fetch(`/api/materials/${materialId}/download`);
                const text = await response.text();
                setContent(text);
            } catch {
                setContent("Failed to load markdown content.");
            } finally {
                setLoading(false);
            }
        };
        fetchContent();
    }, [materialId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="prose prose-sm max-w-none p-6 dark:prose-invert">
            <pre className="whitespace-pre-wrap">{content}</pre>
        </div>
    );
}

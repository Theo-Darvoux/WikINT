"use client";

import { useEffect, useState, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { fetchMaterialFile } from "@/lib/api-client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";

interface MarkdownViewerProps {
    fileKey: string;
    materialId: string;
}

// Extend default sanitize schema to allow highlight.js classes
const sanitizeSchema = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        code: [...(defaultSchema.attributes?.code || []), "className"],
        span: [...(defaultSchema.attributes?.span || []), "className"],
    },
};

const remarkPlugins = [remarkGfm];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rehypePlugins: any[] = [
    rehypeRaw,
    [rehypeSanitize, sanitizeSchema],
    rehypeHighlight,
];

const components: Components = {
    img: ({ src, alt, ...props }) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={src}
            alt={alt || ""}
            loading="lazy"
            className="max-w-full rounded-lg shadow-sm"
            {...props}
        />
    ),
    a: ({ href, children, ...props }) => {
        const isExternal = href?.startsWith("http");
        return (
            <a
                href={href}
                {...(isExternal
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                {...props}
            >
                {children}
            </a>
        );
    },
    table: ({ children, ...props }) => (
        <div className="overflow-x-auto">
            <table {...props}>{children}</table>
        </div>
    ),
};

export function MarkdownViewer({ materialId }: MarkdownViewerProps) {
    const [content, setContent] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const loadContent = () => {
            setLoading(true);
            setError(false);

            fetchMaterialFile(materialId)
                .then((res) => res.text())
                .then((text) => {
                    if (!cancelled) setContent(text);
                })
                .catch(() => {
                    if (!cancelled) setError(true);
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
        };

        loadContent();

        return () => {
            cancelled = true;
        };
    }, [materialId]);

    const rendered = useMemo(
        () =>
            content ? (
                <ReactMarkdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePlugins}
                    components={components}
                >
                    {content}
                </ReactMarkdown>
            ) : null,
        [content],
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
                Failed to load markdown content.
            </div>
        );
    }

    return (
        <div
            className="prose prose-sm max-w-none p-6 dark:prose-invert
                prose-img:rounded-lg prose-img:shadow-sm
                prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                prose-pre:bg-muted prose-pre:border prose-pre:border-border
                prose-code:before:content-none prose-code:after:content-none
                prose-table:border-collapse
                prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-2
                prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2
                prose-headings:scroll-mt-20"
        >
            {rendered}
        </div>
    );
}

"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { fetchMaterialFile } from "@/lib/api-client";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { FullscreenToggle } from "./fullscreen-toggle";
import { ViewerToolbar } from "./viewer-toolbar";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkWikiLink from "remark-wiki-link";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";
import { Mermaid } from "./mermaid";
import { AsyncMaterialImage } from "./async-material-image";
import { Callout, CalloutType } from "./callout";

interface MarkdownViewerProps {
    fileKey: string;
    materialId: string;
    material?: Record<string, unknown>;
}

// Extend default sanitize schema to allow highlight.js classes
const sanitizeSchema = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        code: [...(defaultSchema.attributes?.code || []), "className"],
        span: [...(defaultSchema.attributes?.span || []), "className"],
        img: [...(defaultSchema.attributes?.img || []), "className", "src", "alt", "loading"],
    },
};

const remarkPlugins = [remarkGfm, remarkWikiLink];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rehypePlugins: any[] = [
    rehypeRaw,
    [rehypeSanitize, sanitizeSchema],
    rehypeHighlight,
];

function getTextFromChildren(children: React.ReactNode, depth = 0): string {
    if (depth > 10) return ""; // Prevent deep recursion DoS
    if (children === null || children === undefined) return "";
    if (typeof children === "string") return children;
    if (typeof children === "number") return children.toString();
    if (Array.isArray(children)) {
        return children.map((c) => getTextFromChildren(c, depth + 1)).join("");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = (children as any)?.props;
    if (props?.children) {
        return getTextFromChildren(props.children, depth + 1);
    }
    return "";
}

export function MarkdownViewer({ materialId, material }: MarkdownViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
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
                    // Normalize obsidian image embeds just in case remark-wiki-link doesn't output an `img` tag.
                    // This converts ![[my-image.png]] to ![my-image.png](my-image.png)
                    const parsed = text.replace(/!\[\[(.*?)\]\]/g, "![$1]($1)");
                    if (!cancelled) setContent(parsed);
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

    const components: Components = useMemo(() => ({
        img: (props: any) => {
            const { src, alt } = props;
            return (
                <AsyncMaterialImage
                    src={(src as string) || ""}
                    alt={alt || ""}
                    material={material as any}
                    className="max-w-full rounded-lg shadow-sm"
                />
            );
        },
        a: (props: any) => {
            const { href, children, ...rest } = props;
            const isExternal = href?.startsWith("http");
            return (
                <a
                    href={href}
                    {...(isExternal
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                    {...rest}
                >
                    {children}
                </a>
            );
        },
        table: ({ children, ...props }: any) => (
            <div className="overflow-x-auto">
                <table {...props}>{children}</table>
            </div>
        ),
        code: (props: any) => {
            const { className, children, node, ...rest } = props;
            const match = /language-(\w+)/.exec(className || "");
            const language = match ? match[1] : "";
            
            // Mermaid check (robust)
            const isMermaid = language === "mermaid" || (node?.properties?.className as string[])?.includes("language-mermaid");
            
            // In react-markdown v9/v10, code blocks (pre > code) usually have node metadata 
            // but we can also check if the parent is a 'pre' tag if we had access to it.
            // For now, if it's mermaid, it's definitely a block.
            if (isMermaid) {
                const chart = getTextFromChildren(children);
                return <Mermaid chart={chart.trim()} />;
            }
            return (
                <code className={className} {...rest}>
                    {children}
                </code>
            );
        },
        blockquote: ({ children }: any) => {
            // Find the first paragraph and check if it starts with an Obsidian callout marker
            const allChildren = React.Children.toArray(children);
            const firstChild = allChildren[0] as React.ReactElement<{ children: React.ReactNode, node?: { type: string } }>;
            
            if (firstChild && (firstChild.type === "p" || (firstChild as any).props?.node?.type === "paragraph")) {
                const pChildren = React.Children.toArray(firstChild.props.children);
                const firstPChild = pChildren[0];

                if (typeof firstPChild === "string") {
                    const match = firstPChild.match(/^\[!(\w+)([+-]?)\]\s*(.*)$/);
                    if (match) {
                        const type = match[1].toLowerCase() as CalloutType;
                        const collapseMarker = match[2];
                        const titleText = match[3];
                        const collapsible = collapseMarker === "+" || collapseMarker === "-";
                        const defaultOpen = collapseMarker !== "-";

                        // Remove the marker and title from the first paragraph
                        const remainingPChildren = pChildren.slice(1);
                        const otherChildren = allChildren.slice(1);
                        
                        const newFirstParagraph = remainingPChildren.length > 0 
                            ? React.cloneElement(firstChild, {
                                ...firstChild.props,
                                children: remainingPChildren
                            })
                            : null;

                        return (
                            <Callout 
                                type={type} 
                                collapsible={collapsible} 
                                defaultOpen={defaultOpen}
                                title={titleText ? titleText : undefined}
                            >
                                {newFirstParagraph}
                                {otherChildren}
                            </Callout>
                        );
                    }
                }
            }

            return <blockquote className="border-l-4 border-border pl-4 italic my-4">{children}</blockquote>;
        },
    }), [material]);

    const rendered = useMemo(
        () =>
            content ? (
                <ReactMarkdown
                    remarkPlugins={remarkPlugins as any}
                    rehypePlugins={rehypePlugins as any}
                    components={components}
                >
                    {content}
                </ReactMarkdown>
            ) : null,
        [content, components],
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
            ref={containerRef} 
            className={`relative flex flex-col bg-background min-w-0 w-full ${isFullscreen ? "h-screen" : "h-full"}`}
        >
            <ViewerToolbar 
                right={
                    <FullscreenToggle 
                        isFullscreen={isFullscreen} 
                        onToggle={toggleFullscreen} 
                        disabled={loading || error}
                    />
                }
            />
            <div
                className={`flex-1 overflow-auto prose prose-sm max-w-none p-6 dark:prose-invert
                    prose-img:rounded-lg prose-img:shadow-sm
                    prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                    prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:text-foreground
                    prose-code:before:content-none prose-code:after:content-none prose-code:text-foreground
                    prose-table:border-collapse
                    prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-2
                    prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2
                    prose-headings:scroll-mt-20`}
            >
                {rendered}
            </div>
        </div>
    );
}

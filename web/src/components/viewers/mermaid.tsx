"use client";

import { useEffect, useState, useId } from "react";
import mermaid from "mermaid";
import { useTheme } from "next-themes";
import { Loader2 } from "lucide-react";

interface MermaidProps {
    chart: string;
}

export function Mermaid({ chart }: MermaidProps) {
    const { resolvedTheme } = useTheme();
    const [svg, setSvg] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const componentId = useId().replace(/:/g, ""); // Use useId for stable ID, but remove colons for Mermaid

    useEffect(() => {
        let isMounted = true;
        const MAX_CHART_LENGTH = 50000;

        const renderChart = async () => {
            if (!chart || chart.trim() === "") {
                if (isMounted) {
                    setError("Diagram is empty");
                    setSvg(null);
                }
                return;
            }

            if (chart.length > MAX_CHART_LENGTH) {
                if (isMounted) {
                    setError(`Diagram source is too large (${chart.length} characters, max ${MAX_CHART_LENGTH}) to prevent performance issues.`);
                    setSvg(null);
                }
                return;
            }

            try {
                // Initialize on every render ensures theme is correct
                mermaid.initialize({
                    startOnLoad: false,
                    theme: resolvedTheme === "dark" ? "dark" : "default",
                    securityLevel: "strict",
                    fontFamily: "inherit",
                    // Explicitly disable HTML labels for maximum security
                    htmlLabels: false,
                });

                const id = `mermaid-${componentId}`;
                const { svg: renderedSvg } = await mermaid.render(id, chart);
                
                if (isMounted) {
                    setSvg(renderedSvg);
                    setError(null);
                }
            } catch (err: unknown) {
                console.error("Mermaid render error:", err);
                if (isMounted) {
                    const message = err instanceof Error ? err.message : String(err);
                    setError(message || "Failed to render diagram");
                    setSvg(null);
                }
            }
        };

        renderChart();

        return () => {
            isMounted = false;
        };
    }, [chart, resolvedTheme, componentId]);

    if (error) {
        return (
            <div className="my-4 rounded-md border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
                <span className="font-semibold text-base block mb-1">Mermaid Rendering Error</span>
                <p className="font-mono text-xs opacity-90 break-words">{error}</p>
            </div>
        );
    }

    if (!svg) {
        return (
            <div className="my-4 flex items-center justify-center rounded-md bg-muted p-8 animate-pulse border border-border">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Rendering diagram...</span>
            </div>
        );
    }

    return (
        <div
            className="my-6 flex justify-center overflow-x-auto rounded-lg bg-background p-4 border border-border shadow-sm"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}

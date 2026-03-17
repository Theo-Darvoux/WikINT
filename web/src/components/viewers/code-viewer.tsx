"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import hljs from "highlight.js/lib/common";

/* highlight.js/lib/common includes: bash, c, cpp, csharp, css, diff,
   go, ini, java, javascript, json, kotlin, lua, markdown,
   php, python, r, ruby, rust, scss, shell, sql, swift,
   typescript, xml, yaml, and more.
   We register LaTeX inline since it's not in the common bundle. */

/* Minimal LaTeX grammar */
hljs.registerLanguage("latex", () => ({
    name: "LaTeX",
    aliases: ["tex"],
    contains: [
        { className: "comment", begin: "%", end: "$", relevance: 0 },
        {
            className: "keyword",
            begin: /\\[a-zA-Z@]+/,
            relevance: 0,
        },
        {
            className: "params",
            begin: /\{/,
            end: /\}/,
            contains: [
                { className: "keyword", begin: /\\[a-zA-Z@]+/ },
                "self",
            ],
        },
        {
            className: "params",
            begin: /\[/,
            end: /\]/,
        },
        {
            className: "formula",
            begin: /\$\$/,
            end: /\$\$/,
            contains: [{ className: "keyword", begin: /\\[a-zA-Z@]+/ }],
        },
        {
            className: "formula",
            begin: /\$/,
            end: /\$/,
            contains: [{ className: "keyword", begin: /\\[a-zA-Z@]+/ }],
        },
    ],
}));

/* Register additional aliases */
hljs.registerAliases("toml", { languageName: "ini" });

/* highlight.js theme CSS — loaded once */
import "highlight.js/styles/github.css";

interface CodeViewerProps {
    fileKey: string;
    materialId: string;
    fileName: string;
}

const EXT_TO_LANG: Record<string, string> = {
    // TeX / LaTeX
    tex: "latex", latex: "latex", sty: "latex", cls: "latex", bib: "latex",
    // C / C++
    c: "c", h: "c", cpp: "cpp", cxx: "cpp", cc: "cpp", hpp: "cpp", hxx: "cpp",
    // Python
    py: "python", pyw: "python", pyi: "python",
    // Java
    java: "java",
    // Shell / Bash
    sh: "bash", bash: "bash", zsh: "bash",
    // Web
    js: "javascript", mjs: "javascript", cjs: "javascript",
    jsx: "javascript", ts: "typescript", tsx: "typescript",
    html: "html", css: "css", scss: "scss",
    // Data / Config
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    xml: "xml", sql: "sql", ini: "ini", cfg: "ini", conf: "ini",
    // Other
    rs: "rust", go: "go", rb: "ruby", php: "php",
    cs: "csharp", swift: "swift", kt: "kotlin", scala: "scala",
    lua: "lua", r: "r", hs: "haskell", clj: "clojure",
    md: "markdown", ps1: "powershell",
};

function getLang(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    return EXT_TO_LANG[ext] ?? "";
}

export function CodeViewer({ materialId, fileName }: CodeViewerProps) {
    const [content, setContent] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const codeRef = useRef<HTMLElement>(null);

    const lang = useMemo(() => getLang(fileName), [fileName]);

    // Fetch source text
    useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            setLoading(true);
            setContent("");
        });

        apiRequest(`/materials/${materialId}/file`)
            .then((res) => res.text())
            .then((text) => {
                if (!cancelled) setContent(text);
            })
            .catch(() => {
                if (!cancelled) setContent("Failed to load file content.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [materialId]);

    // Apply highlight.js after content renders
    useEffect(() => {
        if (!content || !codeRef.current) return;
        // Reset any previous highlighting
        codeRef.current.removeAttribute("data-highlighted");
        hljs.highlightElement(codeRef.current);
    }, [content, lang]);

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="overflow-x-auto text-sm">
            <pre className="!m-0 !rounded-none !bg-transparent p-0">
                <code
                    ref={codeRef}
                    className={lang ? `language-${lang}` : ""}
                    style={{ background: "transparent" }}
                >
                    {content}
                </code>
            </pre>
        </div>
    );
}

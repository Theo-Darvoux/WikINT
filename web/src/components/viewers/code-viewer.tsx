"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { fetchMaterialFile } from "@/lib/api-client";
import hljs from "highlight.js/lib/common";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { usePinchZoom } from "@/hooks/use-pinch-zoom";
import { FullscreenToggle } from "./fullscreen-toggle";
import { ViewerToolbar } from "./viewer-toolbar";
import { ZoomControls } from "./zoom-controls";

// Languages from highlight.js/lib/common:
// bash, c, cpp, csharp, css, diff, go, graphql, ini, java, javascript, json,
// kotlin, less, lua, markdown, perl, php, plaintext, python, r, ruby, rust,
// scss, shell, sql, swift, typescript, vbnet, wasm, xml, yaml
//
// We import additional languages not bundled in common:
import hljsDart from "highlight.js/lib/languages/dart";
import hljsElm from "highlight.js/lib/languages/elm";
import hljsElixir from "highlight.js/lib/languages/elixir";
import hljsErlang from "highlight.js/lib/languages/erlang";
import hljsFsharp from "highlight.js/lib/languages/fsharp";
import hljsGroovy from "highlight.js/lib/languages/groovy";
import hljsHaskell from "highlight.js/lib/languages/haskell";
import hljsJulia from "highlight.js/lib/languages/julia";
import hljsMatlab from "highlight.js/lib/languages/matlab";
import hljsNim from "highlight.js/lib/languages/nim";
import hljsNix from "highlight.js/lib/languages/nix";
import hljsOcaml from "highlight.js/lib/languages/ocaml";
import hljsPowershell from "highlight.js/lib/languages/powershell";
import hljsProtobuf from "highlight.js/lib/languages/protobuf";
import hljsScala from "highlight.js/lib/languages/scala";
import hljsClojure from "highlight.js/lib/languages/clojure";
import hljsTcl from "highlight.js/lib/languages/tcl";
import hljsD from "highlight.js/lib/languages/d";
import hljsX86asm from "highlight.js/lib/languages/x86asm";
import hljsCmake from "highlight.js/lib/languages/cmake";

hljs.registerLanguage("dart", hljsDart);
hljs.registerLanguage("elm", hljsElm);
hljs.registerLanguage("elixir", hljsElixir);
hljs.registerLanguage("erlang", hljsErlang);
hljs.registerLanguage("fsharp", hljsFsharp);
hljs.registerLanguage("groovy", hljsGroovy);
hljs.registerLanguage("haskell", hljsHaskell);
hljs.registerLanguage("julia", hljsJulia);
hljs.registerLanguage("matlab", hljsMatlab);
hljs.registerLanguage("nim", hljsNim);
hljs.registerLanguage("nix", hljsNix);
hljs.registerLanguage("ocaml", hljsOcaml);
hljs.registerLanguage("powershell", hljsPowershell);
hljs.registerLanguage("protobuf", hljsProtobuf);
hljs.registerLanguage("scala", hljsScala);
hljs.registerLanguage("clojure", hljsClojure);
hljs.registerLanguage("tcl", hljsTcl);
hljs.registerLanguage("d", hljsD);
hljs.registerLanguage("x86asm", hljsX86asm);
hljs.registerLanguage("cmake", hljsCmake);

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
hljs.registerAliases("toml", { languageName: "ini" }); // toml piggybacks on ini in hljs
hljs.registerAliases(["kts", "groovy", "gradle"], { languageName: "groovy" });
hljs.registerAliases(["lhs"], { languageName: "haskell" });
hljs.registerAliases(["rmd"], { languageName: "r" });
hljs.registerAliases(["exs"], { languageName: "elixir" });
hljs.registerAliases(["hrl", "erlang-repl"], { languageName: "erlang" });
hljs.registerAliases(["cljs", "cljc", "edn"], { languageName: "clojure" });
hljs.registerAliases(["mli"], { languageName: "ocaml" });
hljs.registerAliases(["psm1", "psd1"], { languageName: "powershell" });
hljs.registerAliases(["gql"], { languageName: "graphql" });
hljs.registerAliases(["patch"], { languageName: "diff" });
hljs.registerAliases(["fsx"], { languageName: "fsharp" });
hljs.registerAliases(["pyw", "pyi"], { languageName: "python" });
hljs.registerAliases(["cxx", "cc", "hxx"], { languageName: "cpp" });
hljs.registerAliases(["mjs", "cjs"], { languageName: "javascript" });
hljs.registerAliases(["htm"], { languageName: "xml" });
hljs.registerAliases(["pm"], { languageName: "perl" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["cfg", "conf", "env"], { languageName: "ini" });
hljs.registerAliases(["json5", "jsonc"], { languageName: "json" });
hljs.registerAliases(["md", "markdown"], { languageName: "markdown" });
hljs.registerAliases(["s"], { languageName: "x86asm" });

/* highlight.js theme CSS — loaded once */
import "highlight.js/styles/github.css";

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

const MAX_DISPLAY_BYTES = 512 * 1024; // 512 KiB

interface CodeViewerProps {
    fileKey: string;
    materialId: string;
    fileName: string;
}

const EXT_TO_LANG: Record<string, string> = {
    // TeX / LaTeX
    tex: "latex", latex: "latex", sty: "latex", cls: "latex", bib: "latex",
    dtx: "latex", ins: "latex",
    // C / C++
    c: "c", h: "c", cpp: "cpp", cxx: "cpp", cc: "cpp", hpp: "cpp", hxx: "cpp",
    // Python
    py: "python", pyw: "python", pyi: "python",
    // Java / JVM
    java: "java", kt: "kotlin", kts: "kotlin", scala: "scala",
    groovy: "groovy", gradle: "groovy",
    // Shell / Bash
    sh: "bash", bash: "bash", zsh: "bash", fish: "shell",
    // PowerShell
    ps1: "powershell", psm1: "powershell", psd1: "powershell",
    // Web
    js: "javascript", mjs: "javascript", cjs: "javascript",
    jsx: "javascript", ts: "typescript", tsx: "typescript",
    html: "html", htm: "html",
    css: "css", scss: "scss", sass: "scss", less: "less",
    vue: "xml",    // Vue SFC: best-effort XML highlighting
    svelte: "xml", // Svelte SFC: best-effort XML highlighting
    // Data / Config
    json: "json", json5: "json", jsonc: "json",
    yaml: "yaml", yml: "yaml", toml: "ini",
    xml: "xml", sql: "sql", ini: "ini", cfg: "ini", conf: "ini",
    env: "ini",
    // Config / Build (hcl/tf use ini-like syntax for best-effort highlighting)
    tf: "ini", hcl: "ini", nix: "nix", cmake: "cmake",
    // Systems / Low-level
    rs: "rust", go: "go", zig: "plaintext",
    v: "plaintext", nim: "nim", d: "d",
    asm: "x86asm", s: "x86asm",
    // Scripting
    rb: "ruby", php: "php",
    pl: "perl", pm: "perl",
    lua: "lua", tcl: "tcl",
    // .NET
    cs: "csharp", vb: "vbnet", fs: "fsharp", fsx: "fsharp", swift: "swift",
    // Data science / stats
    r: "r", rmd: "r",
    jl: "julia",
    m: "matlab",
    // ML / AI
    ml: "ocaml", mli: "ocaml",
    // Functional
    hs: "haskell", lhs: "haskell",
    ex: "elixir", exs: "elixir",
    erl: "erlang", hrl: "erlang",
    clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure",
    elm: "elm",
    // Dart
    dart: "dart",
    // Query / API
    graphql: "graphql", gql: "graphql",
    proto: "protobuf",
    // Diff / patch
    diff: "diff", patch: "diff",
    // Markup / docs
    md: "markdown", markdown: "markdown",
    rst: "plaintext", adoc: "plaintext",
    // Text / misc
    txt: "plaintext", log: "plaintext",
};

function getLang(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    return EXT_TO_LANG[ext] ?? "";
}

export function CodeViewer({ materialId, fileName }: CodeViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
    const { zoom, zoomIn, zoomOut, resetZoom } = usePinchZoom({
        initial: 100,
        min: MIN_ZOOM,
        max: MAX_ZOOM,
        step: ZOOM_STEP,
        targetRef: scrollRef,
        handleKeyboard: true,
    });
    const [content, setContent] = useState<string>("");
    const [truncated, setTruncated] = useState(false);
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

        fetchMaterialFile(materialId)
            .then((res) => res.text())
            .then((text) => {
                if (!cancelled) {
                    if (text.length > MAX_DISPLAY_BYTES) {
                        setTruncated(true);
                        setContent(text.slice(0, MAX_DISPLAY_BYTES));
                    } else {
                        setContent(text);
                    }
                }
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
        <div 
            ref={containerRef} 
            className={`relative flex flex-col bg-background min-w-0 w-full ${isFullscreen ? "h-screen" : "h-full"}`}
        >
            <ViewerToolbar 
                left={
                    lang && (
                        <span className="text-xs font-medium uppercase text-muted-foreground px-1.5 py-0.5 bg-muted rounded truncate">
                            {lang}
                        </span>
                    )
                }
                right={
                    <>
                        <ZoomControls
                            zoom={zoom}
                            onZoomIn={zoomIn}
                            onZoomOut={zoomOut}
                            onReset={resetZoom}
                            min={MIN_ZOOM}
                            max={MAX_ZOOM}
                            disabled={loading}
                        />
                        <FullscreenToggle 
                            isFullscreen={isFullscreen} 
                            onToggle={toggleFullscreen} 
                            disabled={loading}
                        />
                    </>
                }
            />
            <div
                ref={scrollRef}
                className="flex-1 overflow-auto bg-zinc-200 dark:bg-zinc-800/50"
                style={{ touchAction: "pan-x pan-y" }}
            >
                {truncated && (
                    <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                        <span>⚠ File truncated — showing first 512 KiB of a larger file. Download to view the full content.</span>
                    </div>
                )}
                <pre
                    className="!m-0 !rounded-none !bg-transparent p-0"
                    style={{ fontSize: `${zoom}%` }}
                >
                    <code
                        ref={codeRef}
                        className={lang ? `language-${lang}` : ""}
                        style={{ background: "transparent" }}
                    >
                        {content}
                    </code>
                </pre>
            </div>
        </div>
    );
}

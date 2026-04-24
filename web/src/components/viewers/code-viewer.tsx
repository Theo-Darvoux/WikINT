"use client";

import { useEffect, useMemo, useRef } from "react";
import hljs from "highlight.js/lib/common";
import { usePinchZoom } from "@/hooks/use-pinch-zoom";
import { useMaterialFile } from "@/hooks/use-material-file";
import { ViewerShell } from "./viewer-shell";
import { ZoomControls } from "./zoom-controls";

// Languages from highlight.js/lib/common... (kept same as original)
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
        { className: "keyword", begin: /\\[a-zA-Z@]+/, relevance: 0 },
        {
            className: "params",
            begin: /\{/,
            end: /\}/,
            contains: [{ className: "keyword", begin: /\\[a-zA-Z@]+/ }, "self"],
        },
        { className: "params", begin: /\[/, end: /\]/ },
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
    tex: "latex", latex: "latex", sty: "latex", cls: "latex", bib: "latex", dtx: "latex", ins: "latex",
    c: "c", h: "c", cpp: "cpp", cxx: "cpp", cc: "cpp", hpp: "cpp", hxx: "cpp",
    py: "python", pyw: "python", pyi: "python",
    java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", groovy: "groovy", gradle: "groovy",
    sh: "bash", bash: "bash", zsh: "bash", fish: "shell",
    ps1: "powershell", psm1: "powershell", psd1: "powershell",
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    html: "html", htm: "html", css: "css", scss: "scss", sass: "scss", less: "less",
    vue: "xml", svelte: "xml",
    json: "json", json5: "json", jsonc: "json", yaml: "yaml", yml: "yaml", toml: "ini", xml: "xml", sql: "sql",
    ini: "ini", cfg: "ini", conf: "ini", env: "ini", tf: "ini", hcl: "ini", nix: "nix", cmake: "cmake",
    rs: "rust", go: "go", zig: "plaintext", v: "plaintext", nim: "nim", d: "d", asm: "x86asm", s: "x86asm",
    rb: "ruby", php: "php", pl: "perl", pm: "perl", lua: "lua", tcl: "tcl",
    cs: "csharp", vb: "vbnet", fs: "fsharp", fsx: "fsharp", swift: "swift",
    r: "r", rmd: "r", jl: "julia", m: "matlab", ml: "ocaml", mli: "ocaml",
    hs: "haskell", lhs: "haskell", ex: "elixir", exs: "elixir", erl: "erlang", hrl: "erlang",
    clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure", elm: "elm",
    dart: "dart", graphql: "graphql", gql: "graphql", proto: "protobuf",
    diff: "diff", patch: "diff", md: "markdown", markdown: "markdown",
    rst: "plaintext", adoc: "plaintext", txt: "plaintext", log: "plaintext",
};

function getLang(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    return EXT_TO_LANG[ext] ?? "";
}

export function CodeViewer({ materialId, fileKey, fileName }: CodeViewerProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const codeRef = useRef<HTMLElement>(null);

    const { content, loading, error, truncated } = useMaterialFile({
        materialId,
        fileKey,
        mode: "text",
        maxBytes: MAX_DISPLAY_BYTES,
    });

    const { zoom, zoomIn, zoomOut, resetZoom } = usePinchZoom({
        initial: 100,
        min: MIN_ZOOM,
        max: MAX_ZOOM,
        step: ZOOM_STEP,
        targetRef: scrollRef,
        handleKeyboard: true,
    });

    const lang = useMemo(() => getLang(fileName), [fileName]);

    // Apply highlight.js after content renders
    useEffect(() => {
        if (!content || !codeRef.current) return;
        codeRef.current.removeAttribute("data-highlighted");
        hljs.highlightElement(codeRef.current);
    }, [content, lang]);

    return (
        <ViewerShell
            scrollRef={scrollRef}
            loading={loading}
            error={error}
            truncatedMessage={truncated ? "File truncated — showing first 512 KiB. Download to view the full content." : null}
            toolbarLeft={
                lang && (
                    <span className="text-xs font-medium uppercase text-muted-foreground px-1.5 py-0.5 bg-muted rounded truncate">
                        {lang}
                    </span>
                )
            }
            toolbarRight={
                <ZoomControls
                    zoom={zoom}
                    onZoomIn={zoomIn}
                    onZoomOut={zoomOut}
                    onReset={resetZoom}
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    disabled={loading}
                />
            }
        >
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
        </ViewerShell>
    );
}

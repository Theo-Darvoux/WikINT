export function muteReactPdfWarnings() {
    if (typeof window === "undefined") return;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.error = (...args) => {
        if (args[0] && typeof args[0] === "string" && args[0].includes("AbortException")) return;
        if (args[0] instanceof Error && args[0].name === "AbortException") return;
        // Sometimes React wraps it with "Warning: AbortException: TextLayer task cancelled."
        originalError(...args);
    };

    console.warn = (...args) => {
        if (args[0] && typeof args[0] === "string" && args[0].includes("AbortException")) return;
        if (args[0] instanceof Error && args[0].name === "AbortException") return;
        originalWarn(...args);
    };
}

/** Maximum upload size in bytes, configurable via NEXT_PUBLIC_MAX_FILE_SIZE_MB (default 100 MiB). */
export const MAX_FILE_SIZE_MB = parseInt(process.env.NEXT_PUBLIC_MAX_FILE_SIZE_MB || "100", 10);
export const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

export function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function getFileExtension(filename: string): string {
    const parts = filename.split(".");
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/** Extension → color classes used by browse listing, viewer header, and sidebar. */
export const EXT_BADGE_COLORS: Record<string, string> = {
    pdf: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
    doc: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
    docx: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
    odt: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
    txt: "bg-slate-100 text-slate-800 dark:bg-slate-800/40 dark:text-slate-300",
    md: "bg-slate-100 text-slate-800 dark:bg-slate-800/40 dark:text-slate-300",
    xls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    xlsx: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    ods: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    csv: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    ppt: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
    pptx: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
    png: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
    jpg: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
    jpeg: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
    gif: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
    webp: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
    svg: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
    mp4: "bg-pink-100 text-pink-800 dark:bg-pink-950/40 dark:text-pink-300",
    webm: "bg-pink-100 text-pink-800 dark:bg-pink-950/40 dark:text-pink-300",
    mp3: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    wav: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    ogg: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    flac: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    aac: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    m4a: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    epub: "bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
    djvu: "bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
    djv: "bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
    zip: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
    js: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300",
    ts: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
    py: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
    html: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
    css: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
    json: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300",
};

const DEFAULT_BADGE_COLOR = "bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300";

/** Get badge color classes for a file, by extension or MIME type. */
export function getFileBadgeColor(fileName: string): string {
    const ext = getFileExtension(fileName);
    return EXT_BADGE_COLORS[ext] ?? DEFAULT_BADGE_COLOR;
}

/** Short uppercase label for a file, e.g. "PDF", "MP3". Falls back to MIME subtype. */
export function getFileBadgeLabel(fileName: string, mimeType?: string): string {
    const ext = getFileExtension(fileName);
    if (ext) return ext.toUpperCase();
    if (mimeType) {
        const sub = mimeType.split("/")[1];
        if (sub && sub !== "octet-stream") return sub.replace(/^(x-|vnd\.)/, "").toUpperCase();
    }
    return "FILE";
}

export function isPreviewable(mimeType: string): boolean {
    const previewable = [
        "application/pdf",
        "image/",
        "video/",
        "audio/",
        "text/",
        "application/json",
        "application/xml",
    ];
    return previewable.some((type) => mimeType.startsWith(type));
}




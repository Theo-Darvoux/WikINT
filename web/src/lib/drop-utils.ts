/**
 * Utilities for handling drag and drop of files and folders using the FileSystem API.
 */

export interface ScannedFile {
    file: File;
    /** Relative path from the drop root including filename, e.g. "FolderA/sub/file.pdf" */
    relativePath: string;
}

export interface DroppedItems {
    /** Flat files dropped directly (not inside a folder at the top level). */
    files: ScannedFile[];
    /** Top-level folder entries — each will be zipped and uploaded via batch-zip. */
    folders: Array<{ entry: FileSystemDirectoryEntry; name: string }>;
}

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    const all: FileSystemEntry[] = [];
    while (true) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
            reader.readEntries(res, rej),
        );
        if (batch.length === 0) break;
        all.push(...batch);
    }
    return all;
}

const MAX_TRAVERSE_DEPTH = 20;

async function traverseEntry(
    entry: FileSystemEntry,
    pathPrefix: string,
    out: ScannedFile[],
    visited: Set<string>,
    depth: number,
): Promise<void> {
    if (depth > MAX_TRAVERSE_DEPTH) return; // guard against very deep trees

    if (entry.isFile) {
        const file = await new Promise<File>((res, rej) =>
            (entry as FileSystemFileEntry).file(res, rej),
        );
        out.push({ file, relativePath: pathPrefix + file.name });
    } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        // Use the full path to detect symlink cycles
        const fullPath = dirEntry.fullPath;
        if (visited.has(fullPath)) return; // cycle detected — skip
        visited.add(fullPath);
        const children = await readAllEntries(dirEntry.createReader());
        for (const child of children) {
            await traverseEntry(child, pathPrefix + dirEntry.name + "/", out, visited, depth + 1);
        }
    }
}

/**
 * Traverse a folder entry recursively and return all contained ScannedFiles.
 * The relative path of each file starts with the folder's name.
 */
export async function traverseFolder(entry: FileSystemDirectoryEntry): Promise<ScannedFile[]> {
    const out: ScannedFile[] = [];
    const visited = new Set<string>();
    await traverseEntry(entry, "", out, visited, 0);
    return out;
}

/**
 * Collect dropped items, separating top-level flat files from top-level folders.
 * Folders are returned as FileSystemDirectoryEntry objects for deferred zip handling.
 */
export async function collectDroppedItems(items: DataTransferItemList): Promise<DroppedItems> {
    const files: ScannedFile[] = [];
    const folders: Array<{ entry: FileSystemDirectoryEntry; name: string }> = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== "file") continue;

        const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
        if (!entry) {
            const f = item.getAsFile();
            if (f) files.push({ file: f, relativePath: f.name });
            continue;
        }

        if (entry.isFile) {
            const f = await new Promise<File>((res, rej) =>
                (entry as FileSystemFileEntry).file(res, rej),
            );
            files.push({ file: f, relativePath: f.name });
        } else if (entry.isDirectory) {
            folders.push({ entry: entry as FileSystemDirectoryEntry, name: entry.name });
        }
    }

    return { files, folders };
}

/**
 * Collect all files from a DataTransferItemList, preserving folder structure.
 * Folders are traversed recursively and their files included with relative paths.
 */
export async function collectDroppedFiles(items: DataTransferItemList): Promise<ScannedFile[]> {
    const out: ScannedFile[] = [];
    const visited = new Set<string>(); // shared across all top-level entries
    const promises: Promise<void>[] = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== "file") continue;

        // Use webkitGetAsEntry to get FileSystemEntry (supported by most modern browsers)
        const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry }).webkitGetAsEntry?.();
        if (entry) {
            promises.push(traverseEntry(entry, "", out, visited, 0));
        } else {
            // Fallback: no FileSystem API support
            const f = item.getAsFile();
            if (f) out.push({ file: f, relativePath: f.name });
        }
    }
    await Promise.all(promises);
    return out;
}

/**
 * Derive all unique directory paths from a list of file paths (excluding root "").
 */
export function extractDirPaths(scanned: ScannedFile[]): string[] {
    const dirs = new Set<string>();
    for (const { relativePath } of scanned) {
        const parts = relativePath.split("/");
        // Parts: ["FolderA", "sub", "file.pdf"] → dirs: ["FolderA", "FolderA/sub"]
        for (let i = 1; i < parts.length; i++) {
            dirs.add(parts.slice(0, i).join("/"));
        }
    }
    // Sort by depth so parents come before children
    return [...dirs].sort((a, b) => {
        const da = a.split("/").length;
        const db = b.split("/").length;
        return da !== db ? da - db : a.localeCompare(b);
    });
}

/**
 * Zip a list of scanned files into a Blob using fflate (store-only, level 0).
 *
 * Level 0 (no compression) is intentional:
 *   - Avoids triggering server-side zip-bomb ratio checks
 *   - Faster to create on the client (no CPU-intensive deflation)
 *   - The individual files are already compressed at the content level (PDF, etc.)
 *
 * The onProgress callback receives 0.0–1.0 as files are read and added.
 */
export async function zipScannedFiles(
    files: ScannedFile[],
    onProgress?: (ratio: number) => void,
): Promise<Blob> {
    const fflate = await import("fflate");
    type Zippable = Record<string, [Uint8Array, { level: 0 }]>;
    const fileData: Zippable = {};
    for (let i = 0; i < files.length; i++) {
        const { file, relativePath } = files[i];
        const buffer = await file.arrayBuffer();
        fileData[relativePath] = [new Uint8Array(buffer), { level: 0 }];
        onProgress?.((i + 1) / files.length * 0.5); // reading phase: 0–50%
    }

    return new Promise((resolve, reject) => {
        fflate.zip(fileData as Parameters<typeof fflate.zip>[0], (err: Error | null, data: Uint8Array) => {
            if (err) {
                reject(err);
            } else {
                onProgress?.(1.0);
                resolve(new Blob([data.buffer as ArrayBuffer], { type: "application/zip" }));
            }
        });
    });
}

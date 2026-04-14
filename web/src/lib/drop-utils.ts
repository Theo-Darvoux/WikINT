/**
 * Utilities for handling drag and drop of files and folders using the FileSystem API.
 */

export interface ScannedFile {
    file: File;
    /** Relative path from the drop root including filename, e.g. "FolderA/sub/file.pdf" */
    relativePath: string;
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
 * Collect all files from a DataTransferItemList, preserving folder structure. 
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

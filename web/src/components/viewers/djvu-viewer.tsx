"use client";

interface DjvuViewerProps {
    fileKey: string;
    materialId: string;
}

export function DjvuViewer({ materialId }: DjvuViewerProps) {
    const downloadUrl = `/api/materials/${materialId}/download`;

    return (
        <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground w-full h-[400px] bg-muted/20 border-2 border-dashed rounded-lg">
            <p className="text-lg font-medium mb-2">Offline DjVu Preview</p>
            <p className="max-w-md mb-6">
                Native browser previewing for DjVu files requires WebAssembly desktop parsers which are currently not installed.
            </p>
            <a
                href={downloadUrl}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
            >
                Download DjVu Document
            </a>
        </div>
    );
}

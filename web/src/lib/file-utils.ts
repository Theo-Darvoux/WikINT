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

export function printBlobUrl(url: string, mimeType?: string) {
    const iframe = document.createElement("iframe");
    iframe.style.position = "absolute";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const isImage = mimeType?.startsWith("image/");

    const triggerPrint = () => {
        setTimeout(() => {
            if (iframe.contentWindow) {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            }
        }, 500);
    };

    if (isImage) {
        // For images, write an HTML document that centers the image and prints it
        const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
        if (doc) {
            doc.open();
            doc.write(`<!DOCTYPE html>
<html><head><style>
  @page { margin: 0; }
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
  img { max-width: 100%; max-height: 100vh; object-fit: contain; }
</style></head><body>
  <img src="${url}" />
</body></html>`);
            doc.close();
            // Wait for the image inside the iframe to load
            const img = doc.querySelector("img");
            if (img && !img.complete) {
                img.onload = triggerPrint;
            } else {
                triggerPrint();
            }
        }
    } else {
        // For PDFs and other natively-renderable content, load the blob directly
        iframe.src = url;
        iframe.onload = triggerPrint;
    }

    // Cleanup iframe after a minute
    setTimeout(() => {
        if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
        }
    }, 60000);
}

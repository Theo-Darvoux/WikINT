"use client";

import { useState, useCallback } from "react";
import { apiFetchBlob, apiRequest } from "@/lib/api-client";
import { isPrintable, printInIframe } from "@/lib/print-utils";
import { toast } from "sonner";

interface UsePrintOptions {
  viewerType: string;
  materialId: string;
  fileName: string;
  mimeType: string;
}

export function usePrint({ viewerType, materialId, fileName, mimeType }: UsePrintOptions) {
  const [isPrinting, setIsPrinting] = useState(false);
  const canPrint = isPrintable(viewerType);

  const print = useCallback(async () => {
    if (!canPrint) return;
    setIsPrinting(true);

    try {
      switch (viewerType) {
        case "pdf": {
          const blob = await apiFetchBlob(`/materials/${materialId}/file`);
          const blobUrl = URL.createObjectURL(blob);
          printInIframe(blobUrl, { isBlobUrl: true, title: fileName });
          // Revoke after a delay to allow the iframe to use it
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
          break;
        }

        case "image": {
          const blob = await apiFetchBlob(`/materials/${materialId}/file`);
          const blobUrl = URL.createObjectURL(blob);
          const html = `
            <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;">
              <img src="${blobUrl}" alt="${fileName}" style="max-width:100%;max-height:100vh;object-fit:contain;" />
            </div>
          `;
          printInIframe(html, { title: fileName });
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
          break;
        }

        case "code": {
          const response = await apiRequest(`/materials/${materialId}/file`);
          const text = await response.text();
          // Escape HTML in the source code
          const escaped = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          const html = `<pre><code>${escaped}</code></pre>`;
          const css = `
            pre { font-size: 11px; line-height: 1.5; }
            code { font-family: "SF Mono", "Fira Code", "Consolas", monospace; }
          `;
          printInIframe(html, { title: fileName, css });
          break;
        }

        case "markdown": {
          const response = await apiRequest(`/materials/${materialId}/file`);
          const text = await response.text();
          const html = `<pre style="white-space:pre-wrap;">${text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")}</pre>`;
          printInIframe(html, { title: fileName });
          break;
        }

        case "office": {
          const fetchFile = () => apiRequest(`/materials/${materialId}/file`);
          let html = "";

          if (mimeType.includes("wordprocessingml")) {
            const mammoth = await import("mammoth");
            const response = await fetchFile();
            const arrayBuffer = await response.arrayBuffer();
            const result = await mammoth.convertToHtml({ arrayBuffer });
            html = result.value;
          } else if (mimeType.includes("spreadsheet") || mimeType === "application/vnd.ms-excel") {
            const XLSX = await import("xlsx");
            const response = await fetchFile();
            const arrayBuffer = await response.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: "array" });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            html = XLSX.utils.sheet_to_html(firstSheet);
          } else {
            toast.info("This office format cannot be printed in-browser. Try downloading the file.");
            return;
          }

          printInIframe(html, { title: fileName });
          break;
        }

        default:
          toast.info("Printing is not supported for this file type.");
          return;
      }

      toast.success("Print dialog opened");
    } catch (error) {
      console.error("Print failed:", error);
      toast.error("Failed to prepare document for printing.");
    } finally {
      setIsPrinting(false);
    }
  }, [viewerType, materialId, fileName, mimeType, canPrint]);

  return { print, isPrinting, canPrint };
}

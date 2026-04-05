"use client";

import { useState, useCallback } from "react";
import { fetchMaterialBlob, fetchMaterialFile } from "@/lib/api-client";
import { isPrintable, printInIframe } from "@/lib/print-utils";
import { getOfficePrint } from "@/lib/office-print-registry";
import { toast } from "sonner";

interface UsePrintOptions {
  viewerType: string;
  materialId: string;
  fileName: string;
  mimeType: string;
}

export function usePrint({ viewerType, materialId, fileName }: UsePrintOptions) {
  const [isPrinting, setIsPrinting] = useState(false);
  const canPrint = isPrintable(viewerType);

  const print = useCallback(async () => {
    if (!canPrint) return;
    setIsPrinting(true);

    try {
      switch (viewerType) {
        case "pdf": {
          const blob = await fetchMaterialBlob(materialId);
          const blobUrl = URL.createObjectURL(blob);
          printInIframe(blobUrl, { isBlobUrl: true, title: fileName });
          // Revoke after a delay to allow the iframe to use it
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
          break;
        }

        case "image": {
          const blob = await fetchMaterialBlob(materialId);
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
          const response = await fetchMaterialFile(materialId);
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
          const response = await fetchMaterialFile(materialId);
          const text = await response.text();
          const html = `<pre style="white-space:pre-wrap;">${text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")}</pre>`;
          printInIframe(html, { title: fileName });
          break;
        }

        case "office": {
          const officePrint = getOfficePrint(materialId);
          if (officePrint) {
            officePrint();
          } else {
            toast.info("Document is still loading. Please try again in a moment.");
            return;
          }
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
  }, [viewerType, materialId, fileName, canPrint]);

  return { print, isPrinting, canPrint };
}

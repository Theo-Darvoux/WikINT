"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Download, Share2, Paperclip, UploadCloud } from "lucide-react";
import { FlagButton } from "@/components/flags/flag-button";
import { useDropZoneStore } from "@/components/pr/global-drop-zone";
import { toast } from "sonner";

interface ViewerFabProps {
    materialId: string;
    materialTitle?: string;
    directoryId?: string;
    attachmentCount?: number;
    isAttachment?: boolean;
}

export function ViewerFab({ materialId, materialTitle, directoryId, attachmentCount = 0, isAttachment = false }: ViewerFabProps) {
    const pathname = usePathname();
    const requestUpload = useDropZoneStore((s) => s.requestUpload);

    const handleShare = () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            toast.success("Link copied to clipboard");
        });
    };

    return (
        <div className="fixed bottom-20 right-4 z-40 flex flex-col gap-2">
            <a
                href={`/api/materials/${materialId}/download`}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-primary shadow-lg"
                aria-label="Download"
            >
                <Download className="h-5 w-5 text-primary-foreground" />
            </a>
            {!isAttachment && (
                <>
                    <button
                        onClick={() =>
                            requestUpload({
                                directoryId: directoryId ?? "",
                                directoryName: materialTitle ?? "Material",
                                parentMaterialId: materialId,
                            })
                        }
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-200 shadow-lg dark:bg-violet-800"
                        aria-label="Upload Attachment"
                    >
                        <UploadCloud className="h-5 w-5 text-violet-700 dark:text-violet-300" />
                    </button>
                    <Link
                        href={`${pathname}/attachments`}
                        className="relative flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 shadow-lg dark:bg-violet-900"
                        aria-label="Attachments"
                    >
                        <Paperclip className="h-5 w-5 text-violet-700 dark:text-violet-300" />
                        {attachmentCount > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
                                {attachmentCount}
                            </span>
                        )}
                    </Link>
                </>
            )}
            <FlagButton
                targetType="material"
                targetId={materialId}
                variant="secondary"
                size="icon"
            />
            <button
                onClick={handleShare}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-muted shadow-lg"
                aria-label="Share"
            >
                <Share2 className="h-5 w-5" />
            </button>
        </div>
    );
}

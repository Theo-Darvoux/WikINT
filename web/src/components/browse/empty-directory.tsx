"use client";

import { FolderOpen } from "lucide-react";
import { useTranslations } from "next-intl";

export function EmptyDirectory() {
  const t = useTranslations("Browse");
  return (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <FolderOpen className="mb-4 h-16 w-16 opacity-30" />
            <p className="text-lg font-medium text-muted-foreground">{t("noItemsYet")}</p>
      <p className="text-sm text-muted-foreground/70 mt-1 max-w-xs">{t("emptyDirectory")}</p>
    </div>
    );
}

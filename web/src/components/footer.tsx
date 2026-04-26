import Link from "next/link";
import { useConfigStore } from "@/lib/stores";
import { useTranslations } from "next-intl";

export function Footer() {
    const t = useTranslations("Layout");
    const { config } = useConfigStore();
    
    return (
        <footer className="border-t py-6 w-full">
            <div className="flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-4">
                    <Link href="/privacy" className="hover:text-foreground transition-colors">
                        {t("privacyPolicy")}
                    </Link>
                    <span>•</span>
                    <Link href="/terms" className="hover:text-foreground transition-colors">
                        {t("termsOfUse")}
                    </Link>
                    <span>•</span>
                    <a
                        href={config?.organization_url || "https://github.com/Theo-Darvoux/WikINT"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-foreground transition-colors"
                    >
                        {config?.organization_url ? t("organization") : t("github")}
                    </a>
                </div>
                <p>{config?.footer_text || "Telecom SudParis • WikINT • IMT-Business School"}</p>
            </div>
        </footer>
    );
}

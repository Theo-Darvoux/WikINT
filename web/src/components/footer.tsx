import Link from "next/link";
import { useConfigStore } from "@/lib/stores";

export function Footer() {
    const { config } = useConfigStore();
    
    return (
        <footer className="border-t py-6">
            <div className="w-full px-4 text-center text-sm text-muted-foreground space-y-2">
                <div className="flex items-center justify-center gap-4">
                    <Link href="/privacy" className="hover:text-foreground transition-colors">
                        Privacy Policy
                    </Link>
                    <span>•</span>
                    <a
                        href={config?.organization_url || "https://github.com/Theo-Darvoux/WikINT"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-foreground transition-colors"
                    >
                        {config?.organization_url ? "Organization" : "GitHub"}
                    </a>
                </div>
                <p>{config?.footer_text || "Telecom SudParis • WikINT • IMT-Business School"}</p>
            </div>
        </footer>
    );
}

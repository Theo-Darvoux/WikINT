import Link from "next/link";

export function Footer() {
    return (
        <footer className="border-t py-6 print:hidden">
            <div className="w-full px-4 text-center text-sm text-muted-foreground space-y-2">
                <div className="flex items-center justify-center gap-4">
                    <Link href="/privacy" className="hover:text-foreground transition-colors">
                        Privacy Policy
                    </Link>
                    <span>·</span>
                    <a
                        href="https://github.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-foreground transition-colors"
                    >
                        GitHub
                    </a>
                </div>
                <p>WikINT — Telecom SudParis / IMT-BS</p>
            </div>
        </footer>
    );
}

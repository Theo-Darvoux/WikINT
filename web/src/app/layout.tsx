import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { LayoutShell } from "@/components/layout-shell";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WikINT — Course Materials",
  description: "Collaborative course materials platform for Telecom SudParis / IMT-BS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          <LayoutShell>{children}</LayoutShell>
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}

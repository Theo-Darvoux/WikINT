import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./print.css";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { LayoutShell } from "@/components/layout-shell";
import { ConfigProvider } from "@/components/config-provider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  title: {
    default: "Course Materials • WikINT",
    template: "%s • WikINT",
  },
  description:
    "Collaborative course materials platform for Telecom SudParis / IMT-BS",
};


import { getMessages, getLocale } from 'next-intl/server';
import { LocaleProvider } from '@/components/locale-provider';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const messages = await getMessages();
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} font-sans`}>
        <LocaleProvider initialLocale={locale} initialMessages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <ConfigProvider>
              <LayoutShell>{children}</LayoutShell>
            </ConfigProvider>
            <Toaster position="bottom-left" expand richColors />
          </ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}

"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { MobileBottomBar } from "@/components/mobile-bottom-bar";
import { Footer } from "@/components/footer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GlobalFloatingSidebar } from "@/components/sidebar/global-floating-sidebar";
import { CookieBanner } from "@/components/cookie-banner";
import { StagingFab } from "@/components/pr/staging-fab";
import { ReviewDrawer } from "@/components/pr/review-drawer";
import { GlobalDropZone } from "@/components/pr/global-drop-zone";
import { useAuth } from "@/hooks/use-auth";
import { getAccessToken, hasAuthHint } from "@/lib/auth-tokens";
import { initAuthSync } from "@/lib/auth-sync";

export function LayoutShell({ children }: { children: ReactNode }) {
    const { isAuthenticated, isLoading, fetchMe } = useAuth();
    const pathname = usePathname();
    const router = useRouter();

    useEffect(() => {
        const cleanup = initAuthSync();
        return cleanup;
    }, []);

    useEffect(() => {
        const token = getAccessToken();
        const hint = hasAuthHint();
        if ((token || hint) && !isAuthenticated && isLoading) {
            fetchMe();
        } else if (!token && !hint && isLoading) {
            // No token and no hint — clear loading state so navbar renders correctly
            fetchMe();
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!isLoading && !isAuthenticated && pathname !== "/login") {
            router.push("/login");
        }
    }, [isLoading, isAuthenticated, pathname, router]);

    const isLoginPage = pathname === "/login";
    const shouldHideContent = !isLoginPage && (isLoading || !isAuthenticated);

    return (
        <div className="flex flex-col min-h-screen">
            <Navbar />
            <main className="flex-1 w-full flex flex-col">
                {shouldHideContent ? (
                    <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] animate-in fade-in duration-500">
                        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent mb-4" />
                        <p className="text-sm text-muted-foreground font-medium animate-pulse">
                            Récupération de la session...
                        </p>
                    </div>
                ) : (
                    children
                )}
            </main>
            <Footer />
            <MobileBottomBar />
            <ConfirmDialog />
            <GlobalFloatingSidebar />
            <StagingFab />
            <ReviewDrawer />
            <GlobalDropZone />
            <CookieBanner />
        </div>
    );
}

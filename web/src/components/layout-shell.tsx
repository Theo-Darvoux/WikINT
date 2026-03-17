"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { MobileBottomBar } from "@/components/mobile-bottom-bar";
import { Footer } from "@/components/footer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GlobalFloatingSidebar } from "@/components/sidebar/global-floating-sidebar";
import { CookieBanner } from "@/components/cookie-banner";
import { CartFab } from "@/components/pr/cart-fab";
import { ReviewDrawer } from "@/components/pr/review-drawer";
import { GlobalDropZone } from "@/components/pr/global-drop-zone";
import { useAuth } from "@/hooks/use-auth";
import { getAccessToken } from "@/lib/auth-tokens";

export function LayoutShell({ children }: { children: ReactNode }) {
    const { isAuthenticated, isLoading, fetchMe } = useAuth();
    const pathname = usePathname();
    const router = useRouter();

    useEffect(() => {
        const token = getAccessToken();
        if (token && !isAuthenticated && isLoading) {
            fetchMe();
        } else if (!token && isLoading) {
            // No token — clear loading state so navbar renders correctly
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
                    <div className="flex-1 flex items-center justify-center min-h-[50vh]">
                        {/* Empty or simple loader while redirecting */}
                    </div>
                ) : (
                    children
                )}
            </main>
            <Footer />
            <MobileBottomBar />
            <ConfirmDialog />
            <GlobalFloatingSidebar />
            <CartFab />
            <ReviewDrawer />
            <GlobalDropZone />
            <CookieBanner />
        </div>
    );
}

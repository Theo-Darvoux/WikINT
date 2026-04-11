"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIsMobile } from "@/hooks/use-media-query";
import { useAuth } from "@/hooks/use-auth";
import { useNotificationStore } from "@/lib/stores";
import { cn } from "@/lib/utils";

export function MobileBottomBar() {
  const isMobile = useIsMobile();
  const { isAuthenticated } = useAuth();
  const { unreadCount } = useNotificationStore();
  const pathname = usePathname();

  if (!isMobile || !isAuthenticated) return null;

  const isHome = pathname === "/";
  const isNotifications = pathname.startsWith("/notifications");
  const isProfile = pathname.startsWith("/profile");

  const tabClass = (active: boolean) =>
    cn(
      "flex flex-col items-center gap-0.5 text-xs transition-colors",
      active
        ? "text-foreground"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur-sm">
      <div className="flex h-14 items-center justify-around">
        {/* Home */}
        <Link href="/" className={tabClass(isHome)}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill={isHome ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          Home
        </Link>

        {/* Notifications */}
        <Link
          href="/notifications"
          className={cn("relative", tabClass(isNotifications))}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill={isNotifications ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -right-2 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
          Notifications
        </Link>

        {/* Profile */}
        <Link href="/profile" className={tabClass(isProfile)}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill={isProfile ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          Profile
        </Link>
      </div>
    </nav>
  );
}

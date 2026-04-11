"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/use-media-query";
import { useAuth } from "@/hooks/use-auth";
import { useNotificationStore } from "@/lib/stores";
import { cn } from "@/lib/utils";
import {
  Home,
  LayoutGrid,
  Send,
  Bell,
  User,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
  match: (pathname: string) => boolean;
  hasBadge?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Home",
    Icon: Home,
    match: (p) => p === "/",
  },
  {
    href: "/browse",
    label: "Browse",
    Icon: LayoutGrid,
    match: (p) => p.startsWith("/browse"),
  },
  {
    href: "/pull-requests",
    label: "PRs",
    Icon: Send,
    match: (p) => p.startsWith("/pull-requests"),
  },
  {
    href: "/notifications",
    label: "Inbox",
    Icon: Bell,
    match: (p) => p.startsWith("/notifications"),
    hasBadge: true,
  },
  {
    href: "/profile",
    label: "Profile",
    Icon: User,
    match: (p) => p.startsWith("/profile"),
  },
];

export function MobileBottomBar() {
  const isMobile = useIsMobile();
  const { isAuthenticated } = useAuth();
  const { unreadCount } = useNotificationStore();
  const pathname = usePathname();

  if (!isMobile || !isAuthenticated) return null;

  const bar = (
    <div
      className="fixed bottom-0 left-0 right-0 z-[60] flex justify-center px-4"
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom, 0px), 14px)",
        transform: "translateZ(0)",
        WebkitTransform: "translateZ(0)",
      }}
    >
      <nav
        aria-label="Main navigation"
        className={cn(
          "flex w-full max-w-md items-center",
          "rounded-2xl px-1.5 py-1.5",
          "border border-border/40 dark:border-border/25",
          "bg-background/75 dark:bg-background/70",
          "backdrop-blur-2xl",
          "shadow-xl shadow-black/[0.07] dark:shadow-black/30",
          // Subtle inner glow on the top edge
          "ring-1 ring-inset ring-white/20 dark:ring-white/4",
        )}
      >
        {NAV_ITEMS.map(({ href, label, Icon, match, hasBadge }) => {
          const isActive = match(pathname);
          const showBadge = !!hasBadge && unreadCount > 0;

          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                // Layout
                "relative flex flex-1 items-center justify-center gap-1.5",
                "rounded-xl py-2.5",
                // Transition — all properties
                "transition-all duration-300 ease-out",
                // Active pill: foreground bg, background text
                isActive
                  ? "bg-foreground text-background shadow-md shadow-black/12 dark:shadow-black/30"
                  : [
                      "text-muted-foreground",
                      "hover:text-foreground hover:bg-accent/70",
                      "active:scale-95 active:opacity-75",
                    ],
              )}
            >
              {/* ── Icon (with optional badge) ── */}
              <span className="relative shrink-0">
                <Icon
                  style={{ width: 19, height: 19 }}
                  strokeWidth={isActive ? 2.3 : 1.75}
                />

                {showBadge && (
                  <span
                    className={cn(
                      "absolute -right-1.75 -top-1.75",
                      "flex min-w-4 items-center justify-center",
                      "h-4 rounded-full px-0.75",
                      "text-[9px] font-bold tabular-nums leading-none",
                      "ring-[1.5px]",
                      isActive
                        ? "bg-background text-foreground ring-foreground"
                        : "bg-destructive text-white ring-background dark:ring-background",
                    )}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );

  return createPortal(bar, document.body);
}

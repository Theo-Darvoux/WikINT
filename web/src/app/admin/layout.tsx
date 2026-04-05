"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { LayoutDashboard, Users, Flag, FolderTree, GitPullRequest } from "lucide-react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const { user, isAuthenticated } = useAuth();
    const pathname = usePathname();

    if (!isAuthenticated) return null;
    if (user?.role !== "moderator" && user?.role !== "bureau" && user?.role !== "vieux") {
        return (
            <div className="flex items-center justify-center p-12 text-muted-foreground">
                You do not have permission to access the admin area.
            </div>
        );
    }

    const navItems = [
        { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
        { href: "/admin/users", label: "Users", icon: Users },
        { href: "/admin/flags", label: "Flags", icon: Flag },
        { href: "/admin/directories", label: "Directories", icon: FolderTree },
        { href: "/admin/pull-requests", label: "Pull Requests", icon: GitPullRequest },
    ];

    return (
        <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 pb-20 sm:pb-6">
            <h1 className="text-3xl font-bold">Admin Area</h1>
            <div className="flex overflow-x-auto border-b pb-px">
                {navItems.map((item) => {
                    const isActive =
                        item.href === "/admin"
                            ? pathname === "/admin"
                            : pathname.startsWith(item.href);
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex min-w-fit items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors hover:text-foreground ${isActive
                                    ? "border-primary text-foreground"
                                    : "border-transparent text-muted-foreground"
                                }`}
                        >
                            <Icon className="h-4 w-4" />
                            {item.label}
                        </Link>
                    );
                })}
            </div>
            <main>{children}</main>
        </div>
    );
}

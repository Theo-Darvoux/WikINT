"use client";

import { useEffect, useState } from "react";
import { Trash2, Search, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AdminUser {
    id: string;
    email: string;
    display_name: string | null;
    role: string | null;
    onboarded: boolean;
    created_at: string;
}

interface PaginatedUsers {
    items: AdminUser[];
    total: number;
    page: number;
    pages: number;
}

const ROLE_BADGE: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    student: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    moderator: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    bureau: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    vieux: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300",
};

export default function AdminUsersPage() {
    const { user } = useAuth();
    const canManageRoles = user?.role === "bureau" || user?.role === "vieux";
    const { show } = useConfirmDialog();

    const [users, setUsers] = useState<AdminUser[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [search, setSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState("all");
    const [loading, setLoading] = useState(true);

    const fetchUsers = async (p = page) => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(p), limit: "50" });
            if (search) params.append("search", search);
            if (roleFilter !== "all") params.append("role", roleFilter);

            const data = await apiFetch<PaginatedUsers>(`/admin/users?${params}`);
            setUsers(data.items);
            setPage(data.page);
            setPages(data.pages);
        } catch {
            toast.error("Failed to load users");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => fetchUsers(1), 300);
        return () => clearTimeout(timer);
    }, [search, roleFilter]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleRoleChange = async (userId: string, newRole: string) => {
        try {
            await apiFetch(`/admin/users/${userId}/role?role=${newRole}`, {
                method: "PATCH",
            });
            setUsers((prev) =>
                prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
            );
            toast.success("Role updated");
        } catch {
            toast.error("Failed to update role");
        }
    };

    const handleApprove = async (userId: string, email: string) => {
        show(
            "Approve user?",
            `Grant ${email} full student access?`,
            async () => {
                try {
                    const updated = await apiFetch<AdminUser>(`/admin/users/${userId}/approve`, { method: "POST" });
                    setUsers((prev) =>
                        prev.map((u) => (u.id === userId ? { ...u, role: updated.role } : u))
                    );
                    toast.success("User approved");
                } catch {
                    toast.error("Failed to approve user");
                }
            }
        );
    };

    const handleReject = async (userId: string, email: string) => {
        show(
            "Reject and delete user?",
            `This will permanently delete ${email}'s account. They will need to re-register if they want access.`,
            async () => {
                try {
                    await apiFetch(`/admin/users/${userId}/reject`, { method: "POST" });
                    setUsers((prev) => prev.filter((u) => u.id !== userId));
                    toast.success("User rejected and deleted");
                } catch {
                    toast.error("Failed to reject user");
                }
            }
        );
    };

    const handleDelete = (userId: string, email: string) => {
        show(
            "Soft-delete user?",
            `Are you sure you want to delete ${email}? This action prevents login and initiates the 30-day GDPR cleanup period.`,
            async () => {
                try {
                    await apiFetch(`/admin/users/${userId}`, { method: "DELETE" });
                    setUsers((prev) => prev.filter((u) => u.id !== userId));
                    toast.success("User deleted");
                } catch {
                    toast.error("Failed to delete user");
                }
            }
        );
    };

    const pendingCount = users.filter((u) => u.role === "pending").length;

    return (
        <div className="space-y-4">
            {/* Pending banner */}
            {roleFilter === "pending" || pendingCount > 0 ? (
                <div
                    role="alert"
                    className={cn(
                        "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm",
                        "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
                    )}
                >
                    <span className="font-medium">
                        {pendingCount} pending {pendingCount === 1 ? "user" : "users"} awaiting approval
                    </span>
                    {roleFilter !== "pending" && (
                        <button
                            onClick={() => setRoleFilter("pending")}
                            className="ml-auto text-xs underline underline-offset-2 hover:no-underline"
                        >
                            Show only pending
                        </button>
                    )}
                </div>
            ) : null}

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name or email..."
                        className="pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-full sm:w-[180px]">
                        <SelectValue placeholder="All roles" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All roles</SelectItem>
                        <SelectItem value="pending">⏳ Pending</SelectItem>
                        <SelectItem value="student">Student</SelectItem>
                        <SelectItem value="moderator">Moderator</SelectItem>
                        <SelectItem value="bureau">Bureau</SelectItem>
                        <SelectItem value="vieux">Vieux</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="rounded-lg border bg-card">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="border-b bg-muted/50 text-muted-foreground">
                            <tr>
                                <th className="p-4 font-medium">Email</th>
                                <th className="p-4 font-medium">Name</th>
                                <th className="p-4 font-medium">Role</th>
                                <th className="p-4 font-medium text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {users.map((u) => (
                                <tr
                                    key={u.id}
                                    className={cn(
                                        "transition-colors hover:bg-muted/30",
                                        u.role === "pending" && "bg-amber-50/50 dark:bg-amber-900/10"
                                    )}
                                >
                                    <td className="p-4 font-medium">{u.email}</td>
                                    <td className="p-4 text-muted-foreground">
                                        {u.display_name ?? "-"}
                                    </td>
                                    <td className="p-4">
                                        {canManageRoles && u.id !== user?.id && u.role !== "pending" ? (
                                            <Select
                                                value={u.role || "student"}
                                                onValueChange={(val) => handleRoleChange(u.id, val)}
                                            >
                                                <SelectTrigger className="h-8 max-w-[120px] text-xs">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="student">Student</SelectItem>
                                                    <SelectItem value="moderator">Moderator</SelectItem>
                                                    <SelectItem value="bureau">Bureau</SelectItem>
                                                    <SelectItem value="vieux">Vieux</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <Badge
                                                className={cn(
                                                    "capitalize text-xs font-medium border-0",
                                                    ROLE_BADGE[u.role ?? "student"] ?? ROLE_BADGE.student
                                                )}
                                            >
                                                {u.role === "pending" ? "⏳ Pending" : u.role}
                                            </Badge>
                                        )}
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            {/* Pending user: approve + reject */}
                                            {canManageRoles && u.role === "pending" && (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleApprove(u.id, u.email)}
                                                        className="text-green-600 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/20"
                                                        title="Approve user"
                                                    >
                                                        <CheckCircle className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleReject(u.id, u.email)}
                                                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                        title="Reject and delete user"
                                                    >
                                                        <XCircle className="h-4 w-4" />
                                                    </Button>
                                                </>
                                            )}
                                            {/* Non-pending: delete */}
                                            {canManageRoles && u.id !== user?.id && u.role !== "pending" && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDelete(u.id, u.email)}
                                                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                    title="Delete user"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {loading && users.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="p-8 text-center text-muted-foreground">
                                        Loading users...
                                    </td>
                                </tr>
                            )}
                            {!loading && users.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="p-8 text-center text-muted-foreground">
                                        No users found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {pages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => fetchUsers(page - 1)}
                    >
                        Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        {page} of {pages}
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={page >= pages}
                        onClick={() => fetchUsers(page + 1)}
                    >
                        Next
                    </Button>
                </div>
            )}
        </div>
    );
}

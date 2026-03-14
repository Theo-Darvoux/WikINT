"use client";

import { useEffect, useState } from "react";
import { Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";

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

    return (
        <div className="space-y-4">
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
                        <SelectItem value="student">Student</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
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
                                <tr key={u.id} className="transition-colors hover:bg-muted/30">
                                    <td className="p-4 font-medium">{u.email}</td>
                                    <td className="p-4 text-muted-foreground">
                                        {u.display_name ?? "-"}
                                    </td>
                                    <td className="p-4">
                                        {canManageRoles && u.id !== user?.id ? (
                                            <Select
                                                value={u.role || "student"}
                                                onValueChange={(val) => handleRoleChange(u.id, val)}
                                            >
                                                <SelectTrigger className="h-8 max-w-[120px] text-xs">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="student">Student</SelectItem>
                                                    <SelectItem value="member">Member</SelectItem>
                                                    <SelectItem value="bureau">Bureau</SelectItem>
                                                    <SelectItem value="vieux">Vieux</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <span className="capitalize text-muted-foreground">
                                                {u.role}
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-4 text-right">
                                        {canManageRoles && u.id !== user?.id && (
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

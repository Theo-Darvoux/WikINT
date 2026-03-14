"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { Check, CheckCircle2, MessageSquare, Flag, ThumbsUp, GitPullRequest } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { useNotificationStore } from "@/lib/stores";
import { toast } from "sonner";

interface NotificationItem {
    id: string;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
    read: boolean;
    created_at: string;
}

interface PaginatedNotifications {
    items: NotificationItem[];
    total: number;
    page: number;
    pages: number;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
    pr_approved: CheckCircle2,
    pr_rejected: GitPullRequest,
    pr_voted: ThumbsUp,
    annotation_reply: MessageSquare,
    pr_comment_reply: MessageSquare,
    flag_resolved: Flag,
    new_flag: Flag,
};

export default function NotificationsPage() {
    const [notifications, setNotifications] = useState<NotificationItem[]>([]);
    const [loading, setLoading] = useState(true);
    const { setUnreadCount } = useNotificationStore();

    const fetchNotifications = useCallback(async () => {
        try {
            const data = await apiFetch<PaginatedNotifications>("/notifications?limit=50");
            setNotifications(data.items);
            const unread = data.items.filter((n) => !n.read).length;
            setUnreadCount(unread);
        } catch {
            toast.error("Failed to load notifications");
        } finally {
            setLoading(false);
        }
    }, [setUnreadCount]);

    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications]);

    const markRead = async (id: string) => {
        try {
            await apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
            setNotifications((prev) =>
                prev.map((n) => (n.id === id ? { ...n, read: true } : n))
            );
            setUnreadCount(notifications.filter((n) => !n.read && n.id !== id).length);
        } catch {
            toast.error("Failed to mark as read");
        }
    };

    const markAllRead = async () => {
        try {
            await apiFetch("/notifications/read-all", { method: "POST" });
            setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
            setUnreadCount(0);
        } catch {
            toast.error("Failed to mark all as read");
        }
    };

    if (loading) {
        return <div className="p-6 text-center text-muted-foreground">Loading...</div>;
    }

    return (
        <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6 pb-20 sm:pb-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Notifications</h1>
                {notifications.some((n) => !n.read) && (
                    <Button variant="outline" size="sm" onClick={markAllRead}>
                        <Check className="mr-2 h-4 w-4" />
                        Mark all as read
                    </Button>
                )}
            </div>

            {notifications.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                    <p>No notifications yet.</p>
                </div>
            ) : (
                <div className="divide-y rounded-lg border">
                    {notifications.map((n) => {
                        const Icon = TYPE_ICONS[n.type] || MessageSquare;
                        return (
                            <div
                                key={n.id}
                                className={`flex items-start gap-4 p-4 transition-colors ${n.read ? "bg-muted/30" : "bg-background"
                                    }`}
                                onClick={() => !n.read && markRead(n.id)}
                            >
                                <div
                                    className={`mt-1 rounded-full p-2 ${n.read ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                                        }`}
                                >
                                    <Icon className="h-4 w-4" />
                                </div>
                                <div className="flex-1 space-y-1">
                                    <p className={`text-sm ${n.read ? "text-muted-foreground" : "font-medium"}`}>
                                        {n.title}
                                    </p>
                                    {n.body && (
                                        <p className="line-clamp-2 text-sm text-muted-foreground">
                                            {n.body}
                                        </p>
                                    )}
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs text-muted-foreground">
                                            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                                        </span>
                                        {n.link && (
                                            <Link
                                                href={n.link}
                                                className="text-xs text-primary hover:underline"
                                            >
                                                View details
                                            </Link>
                                        )}
                                    </div>
                                </div>
                                {!n.read && (
                                    <div className="h-2 w-2 rounded-full bg-primary" />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

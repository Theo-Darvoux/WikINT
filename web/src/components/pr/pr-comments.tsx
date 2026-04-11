"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Edit2, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/lib/stores";
import { useIsMobile } from "@/hooks/use-media-query";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { FlagButton } from "@/components/flags/flag-button";

interface PRComment {
    id: string;
    body: string;
    author_id: string | null;
    author: { id: string; display_name: string } | null;
    created_at: string;
}

const MAX_COMMENT_LENGTH = 10000;

export function PRComments({ prId }: { prId: string }) {
    const isMobile = useIsMobile();
    const { user } = useAuthStore();
    const [comments, setComments] = useState<PRComment[]>([]);
    const [body, setBody] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editBody, setEditBody] = useState("");

    const fetchComments = async () => {
        try {
            const res = await apiFetch<PRComment[]>(
                `/pull-requests/${prId}/comments`,
            );
            setComments(res);
        } catch {}
    };

    useEffect(() => {
        fetchComments();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prId]);

    const handleSubmit = async () => {
        if (!body.trim()) return;
        if (body.length > MAX_COMMENT_LENGTH) {
            toast.error(`Comment exceeds ${MAX_COMMENT_LENGTH.toLocaleString()} character limit`);
            return;
        }
        setSubmitting(true);
        try {
            const newComment = await apiFetch<PRComment>(`/pull-requests/${prId}/comments`, {
                method: "POST",
                body: JSON.stringify({ body }),
            });
            setBody("");
            setComments((prev) => [...prev, newComment]);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to post comment");
        } finally {
            setSubmitting(false);
        }
    };

    const handleEdit = async (id: string) => {
        if (!editBody.trim()) return;
        if (editBody.length > MAX_COMMENT_LENGTH) {
            toast.error(`Comment exceeds ${MAX_COMMENT_LENGTH.toLocaleString()} character limit`);
            return;
        }
        try {
            const updated = await apiFetch<PRComment>(`/pr-comments/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ body: editBody.trim() }),
            });
            setEditingId(null);
            setEditBody("");
            setComments((prev) => prev.map((c) => (c.id === id ? updated : c)));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to edit comment");
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await apiFetch(`/pr-comments/${id}`, { method: "DELETE" });
            setComments((prev) => prev.filter((c) => c.id !== id));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to delete comment");
        }
    };

    const startEdit = (id: string, currentBody: string) => {
        setEditingId(id);
        setEditBody(currentBody);
    };

    const getInitials = (name: string) =>
        name
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();

    const currentUserId = user?.id ?? null;
    const currentUserRole = user?.role ?? null;
    const isModerator =
        currentUserRole === "moderator" ||
        currentUserRole === "bureau" ||
        currentUserRole === "vieux";

    return (
        <div className="space-y-4">
            {comments.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                    <MessageSquare className="h-8 w-8 opacity-40" />
                    <p className="text-sm">
                        No comments yet. Start the discussion.
                    </p>
                </div>
            )}

            {comments.map((c) => {
                const isAuthor = currentUserId && c.author_id === currentUserId;
                const canEdit = isAuthor;
                const canDelete = isAuthor || isModerator;

                if (editingId === c.id) {
                    return (
                        <div key={c.id} className="flex gap-3">
                            <Avatar size="sm" className="mt-0.5 shrink-0">
                                <AvatarFallback className="text-[10px]">
                                    {c.author?.display_name
                                        ? getInitials(c.author.display_name)
                                        : "?"}
                                </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1 space-y-2">
                                <Textarea
                                    value={editBody}
                                    onChange={(e) => setEditBody(e.target.value)}
                                    className="min-h-[60px] text-sm"
                                />
                                <span className={`text-[10px] ${editBody.length > MAX_COMMENT_LENGTH ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                                    {editBody.length.toLocaleString()}/{MAX_COMMENT_LENGTH.toLocaleString()}
                                </span>
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        onClick={() => handleEdit(c.id)}
                                        disabled={!editBody.trim() || editBody.length > MAX_COMMENT_LENGTH}
                                    >
                                        Save
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setEditingId(null)}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        </div>
                    );
                }

                return (
                    <div key={c.id} className="group flex gap-3">
                        <Avatar size="sm" className="mt-0.5 shrink-0">
                            <AvatarFallback className="text-[10px]">
                                {c.author?.display_name
                                    ? getInitials(c.author.display_name)
                                    : "?"}
                            </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                                <span className="text-sm font-medium">
                                    {c.author?.display_name || "[deleted]"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {formatDistanceToNow(new Date(c.created_at), {
                                        addSuffix: true,
                                    })}
                                </span>
                            </div>
                            <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
                                {c.body}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1">
                                {canEdit && (
                                    <button
                                        onClick={() => startEdit(c.id, c.body)}
                                        className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                                    >
                                        <Edit2 className="h-3 w-3" />
                                        Edit
                                    </button>
                                )}
                                {canDelete ? (
                                    <ConfirmDeleteDialog
                                        onConfirm={() => handleDelete(c.id)}
                                        title="Delete comment"
                                        description="Are you sure you want to delete this comment? This action cannot be undone."
                                    />
                                ) : (
                                    <FlagButton
                                        targetType="pr_comment"
                                        targetId={c.id}
                                        variant="ghost"
                                        className="h-auto p-0 px-1 py-0.5 text-[10px] font-normal text-muted-foreground hover:bg-muted hover:text-foreground gap-1"
                                        iconClassName="h-3 w-3"
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}

            {/* Comment form */}
            <div className="space-y-2 pt-2">
                <Textarea
                    placeholder="Leave a comment…"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="flex-1 text-sm bg-muted/40 focus-visible:bg-background transition-all resize-none overflow-hidden py-2"
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !isMobile) {
                            e.preventDefault();
                            handleSubmit();
                        }
                    }}
                    style={{ height: "auto" }}
                    onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = "auto";
                        target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
                    }}
                />
                <div className="flex items-center justify-between px-0.5">
                    <div className="flex flex-col gap-0.5">
                        <span className={`text-[10px] ${body.length > MAX_COMMENT_LENGTH ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                            {body.length.toLocaleString()}/{MAX_COMMENT_LENGTH.toLocaleString()}
                        </span>
                        {!isMobile && (
                            <span className="text-[9px] text-muted-foreground italic opacity-70">
                                Shift+Enter for new line
                            </span>
                        )}
                    </div>
                    <Button
                        size="sm"
                        disabled={!body.trim() || submitting || body.length > MAX_COMMENT_LENGTH}
                        onClick={handleSubmit}
                        className="gap-1.5"
                    >
                        <Send className="h-3.5 w-3.5" />
                        {submitting ? "Posting…" : "Comment"}
                    </Button>
                </div>
            </div>
        </div>
    );
}

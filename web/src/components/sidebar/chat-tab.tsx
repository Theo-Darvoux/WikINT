"use client";

import { useCallback, useEffect, useState } from "react";
import { Edit2, Send } from "lucide-react";
import { FlagButton } from "@/components/flags/flag-button";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/stores";

interface CommentAuthor {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
}

interface Comment {
    id: string;
    target_type: string;
    target_id: string;
    author_id: string | null;
    author: CommentAuthor | null;
    body: string;
    created_at: string;
    updated_at: string;
}

interface PaginatedComments {
    items: Comment[];
    total: number;
    page: number;
    pages: number;
}

interface SidebarTarget {
    type: "directory" | "material";
    id: string;
    data: Record<string, unknown>;
}

function getInitials(name: string | null): string {
    if (!name) return "?";
    return name
        .split(" ")
        .map((s) => s[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

function CommentItem({
    comment,
    currentUserId,
    currentUserRole,
    onEdit,
    onDelete,
}: {
    comment: Comment;
    currentUserId: string | null;
    currentUserRole: string | null;
    onEdit: (id: string, body: string) => void;
    onDelete: (id: string) => void;
}) {
    const isAuthor = currentUserId && comment.author_id === currentUserId;
    const isModerator =
        currentUserRole === "member" ||
        currentUserRole === "bureau" ||
        currentUserRole === "vieux";
    const canEdit = isAuthor;
    const canDelete = isAuthor || isModerator;

    const authorName = comment.author?.display_name ?? "[deleted]";
    const date = new Date(comment.created_at);

    return (
        <div className="group flex gap-2.5 py-2">
            <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback className="text-[10px]">
                    {getInitials(comment.author?.display_name ?? null)}
                </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">{authorName}</span>
                    <span className="text-xs text-muted-foreground">
                        {date.toLocaleDateString()}
                    </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{comment.body}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                    {canEdit && (
                        <button
                            onClick={() => onEdit(comment.id, comment.body)}
                            className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            <Edit2 className="h-3 w-3" />
                            Edit
                        </button>
                    )}
                    {canDelete ? (
                        <ConfirmDeleteDialog
                            onConfirm={() => onDelete(comment.id)}
                            title="Delete comment"
                            description="Are you sure you want to delete this comment? This action cannot be undone."
                        />
                    ) : (
                        <FlagButton
                            targetType="comment"
                            targetId={comment.id}
                            variant="ghost"
                            className="h-auto p-0 px-1 py-0.5 text-[10px] font-normal text-muted-foreground hover:bg-muted hover:text-foreground gap-1"
                            iconClassName="h-3 w-3"
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

interface ChatTabProps {
    target: SidebarTarget | null;
}

export function ChatTab({ target }: ChatTabProps) {
    const { user } = useAuthStore();
    const [comments, setComments] = useState<Comment[]>([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [body, setBody] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editBody, setEditBody] = useState("");

    const fetchComments = useCallback(
        async (p: number) => {
            if (!target) return;
            setLoading(true);
            try {
                const data = await apiFetch<PaginatedComments>(
                    `/comments?targetType=${target.type}&targetId=${target.id}&page=${p}&limit=50`
                );
                setComments(data.items);
                setPage(data.page);
                setPages(data.pages);
            } catch {
                // silent
            } finally {
                setLoading(false);
            }
        },
        [target]
    );

    useEffect(() => {
        setComments([]);
        setPage(1);
        if (target) fetchComments(1);
    }, [target, fetchComments]);

    const handleSubmit = async () => {
        if (!target || !body.trim()) return;
        setSubmitting(true);
        try {
            await apiFetch<Comment>("/comments", {
                method: "POST",
                body: JSON.stringify({
                    target_type: target.type,
                    target_id: target.id,
                    body: body.trim(),
                }),
            });
            setBody("");
            fetchComments(page);
        } catch {
            // silent
        } finally {
            setSubmitting(false);
        }
    };

    const handleEdit = async (id: string) => {
        if (!editBody.trim()) return;
        try {
            await apiFetch<Comment>(`/comments/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ body: editBody.trim() }),
            });
            setEditingId(null);
            setEditBody("");
            fetchComments(page);
        } catch {
            // silent
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await apiFetch<void>(`/comments/${id}`, { method: "DELETE" });
            fetchComments(page);
        } catch {
            // silent
        }
    };

    const startEdit = (id: string, currentBody: string) => {
        setEditingId(id);
        setEditBody(currentBody);
    };

    if (!target) {
        return <p className="text-sm text-muted-foreground">Select an item to view chat.</p>;
    }

    return (
        <div className="flex h-full flex-col">
            <div className="flex-1 space-y-1">
                {loading && comments.length === 0 && (
                    <div className="space-y-3 py-2">
                        {Array.from({ length: 3 }, (_, i) => (
                            <div key={i} className="flex gap-2.5">
                                <Skeleton className="h-7 w-7 rounded-full" />
                                <div className="flex-1 space-y-1">
                                    <Skeleton className="h-3 w-24" />
                                    <Skeleton className="h-3 w-full" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!loading && comments.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                        No comments yet. Be the first to comment!
                    </p>
                )}

                {comments.map((c) =>
                    editingId === c.id ? (
                        <div key={c.id} className="space-y-2 py-2">
                            <Textarea
                                value={editBody}
                                onChange={(e) => setEditBody(e.target.value)}
                                className="min-h-[60px] text-sm"
                            />
                            <div className="flex gap-2">
                                <Button
                                    size="sm"
                                    onClick={() => handleEdit(c.id)}
                                    disabled={!editBody.trim()}
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
                    ) : (
                        <CommentItem
                            key={c.id}
                            comment={c}
                            currentUserId={user?.id ?? null}
                            currentUserRole={user?.role ?? null}
                            onEdit={startEdit}
                            onDelete={handleDelete}
                        />
                    )
                )}

                {pages > 1 && (
                    <div className="flex items-center justify-center gap-2 py-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={page <= 1}
                            onClick={() => fetchComments(page - 1)}
                        >
                            Prev
                        </Button>
                        <span className="text-xs text-muted-foreground">
                            {page} / {pages}
                        </span>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={page >= pages}
                            onClick={() => fetchComments(page + 1)}
                        >
                            Next
                        </Button>
                    </div>
                )}
            </div>

            <div className="mt-3 flex gap-2 border-t pt-3">
                <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Write a comment..."
                    className="min-h-[40px] flex-1 text-sm"
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSubmit();
                        }
                    }}
                />
                <Button
                    size="icon"
                    onClick={handleSubmit}
                    disabled={submitting || !body.trim()}
                    className="shrink-0 self-end"
                >
                    <Send className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}

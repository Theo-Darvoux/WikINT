"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageSquare, Send } from "lucide-react";

interface PRComment {
    id: string;
    body: string;
    author: { id: string; display_name: string } | null;
    created_at: string;
}

export function PRComments({ prId }: { prId: string }) {
    const [comments, setComments] = useState<PRComment[]>([]);
    const [body, setBody] = useState("");
    const [submitting, setSubmitting] = useState(false);

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
        setSubmitting(true);
        try {
            await apiFetch(`/pull-requests/${prId}/comments`, {
                method: "POST",
                body: JSON.stringify({ body }),
            });
            setBody("");
            fetchComments();
        } finally {
            setSubmitting(false);
        }
    };

    const getInitials = (name: string) =>
        name
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();

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

            {comments.map((c) => (
                <div key={c.id} className="flex gap-3">
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
                    </div>
                </div>
            ))}

            {/* Comment form */}
            <div className="space-y-2 pt-2">
                <Textarea
                    placeholder="Leave a comment…"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={2}
                    className="resize-none"
                />
                <div className="flex justify-end">
                    <Button
                        size="sm"
                        disabled={!body.trim() || submitting}
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

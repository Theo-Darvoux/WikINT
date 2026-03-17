"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { AnnotationThread, AnnotationForm } from "@/components/annotations/annotation-thread";
import { useAnnotationsContext } from "@/hooks/use-annotations";
import { useAuthStore } from "@/lib/stores";

interface SidebarTarget {
    type: "directory" | "material";
    id: string;
    data: Record<string, unknown>;
}

interface AnnotationsTabProps {
    target: SidebarTarget | null;
}

export function AnnotationsTab({ target }: AnnotationsTabProps) {
    const { user } = useAuthStore();
    const ctx = useAnnotationsContext();
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editBody, setEditBody] = useState("");

    if (!ctx || !target || target.type !== "material") {
        return (
            <p className="text-sm text-muted-foreground">
                Annotations are only available for materials.
            </p>
        );
    }

    const { threads, loading, page, pages, fetchAnnotations, createAnnotation, editAnnotation, deleteAnnotation } = ctx;

    const handleReply = (annotationId: string) => {
        setReplyingTo(annotationId);
        setEditingId(null);
    };

    const handleSubmitReply = async (body: string) => {
        if (!replyingTo) return;
        await createAnnotation(body, undefined, undefined, undefined, replyingTo);
        setReplyingTo(null);
    };

    const handleStartEdit = (id: string, body: string) => {
        setEditingId(id);
        setEditBody(body);
        setReplyingTo(null);
    };

    const handleSaveEdit = async () => {
        if (!editingId || !editBody.trim()) return;
        await editAnnotation(editingId, editBody.trim());
        setEditingId(null);
        setEditBody("");
    };

    const handleDelete = async (id: string) => {
        await deleteAnnotation(id);
    };

    return (
        <div className="flex h-full flex-col space-y-3">
            {loading && threads.length === 0 && (
                <div className="space-y-3 py-2">
                    {Array.from({ length: 3 }, (_, i) => (
                        <div key={i} className="space-y-1.5 rounded-md border p-2">
                            <div className="flex gap-2">
                                <Skeleton className="h-6 w-6 rounded-full" />
                                <div className="flex-1 space-y-1">
                                    <Skeleton className="h-3 w-20" />
                                    <Skeleton className="h-3 w-full" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {!loading && threads.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <MessageCircle className="mb-3 h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                        No annotations yet.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Select text in the document to start annotating.
                    </p>
                </div>
            )}

            {threads.map((thread) => (
                <div key={thread.root.id}>
                    <AnnotationThread
                        thread={thread}
                        currentUserId={user?.id ?? null}
                        currentUserRole={user?.role ?? null}
                        onReply={handleReply}
                        onEdit={handleStartEdit}
                        onDelete={handleDelete}
                    />
                    {replyingTo &&
                        (
                            thread.root.id === replyingTo ||
                            thread.replies.some((r) => r.id === replyingTo)
                        ) && (
                            <div className="ml-4 mt-2">
                                <AnnotationForm
                                    onSubmit={handleSubmitReply}
                                    placeholder="Write a reply..."
                                    submitLabel="Reply"
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="mt-1"
                                    onClick={() => setReplyingTo(null)}
                                >
                                    Cancel
                                </Button>
                            </div>
                        )}
                </div>
            ))}

            {editingId && (
                <div className="space-y-2 rounded-md border p-2">
                    <Textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value.slice(0, 1000))}
                        className="min-h-[60px] text-sm"
                    />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={handleSaveEdit} disabled={!editBody.trim()}>
                            Save
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setEditingId(null);
                                setEditBody("");
                            }}
                        >
                            Cancel
                        </Button>
                    </div>
                </div>
            )}

            {pages > 1 && (
                <div className="flex items-center justify-center gap-2 py-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => fetchAnnotations(page - 1)}
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
                        onClick={() => fetchAnnotations(page + 1)}
                    >
                        Next
                    </Button>
                </div>
            )}
        </div>
    );
}

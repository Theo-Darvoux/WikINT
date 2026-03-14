"use client";

import { useState } from "react";
import { Edit2, Reply, Send } from "lucide-react";
import { FlagButton } from "@/components/flags/flag-button";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { AnnotationData, ThreadData } from "@/hooks/use-annotations";

function getInitials(name: string | null): string {
    if (!name) return "?";
    return name
        .split(" ")
        .map((s) => s[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

function AnnotationItem({
    annotation,
    currentUserId,
    currentUserRole,
    onReply,
    onEdit,
    onDelete,
    replyToAnnotation,
}: {
    annotation: AnnotationData;
    currentUserId: string | null;
    currentUserRole: string | null;
    onReply: (id: string) => void;
    onEdit: (id: string, body: string) => void;
    onDelete: (id: string) => void;
    replyToAnnotation?: AnnotationData | null;
}) {
    const isAuthor = currentUserId && annotation.author_id === currentUserId;
    const isModerator =
        currentUserRole === "member" ||
        currentUserRole === "bureau" ||
        currentUserRole === "vieux";
    const canEdit = isAuthor;
    const canDelete = isAuthor || isModerator;

    const authorName = annotation.author?.display_name ?? "[deleted]";
    const date = new Date(annotation.created_at);

    return (
        <div className="group flex gap-2 py-1.5">
            <Avatar className="h-6 w-6 shrink-0">
                <AvatarFallback className="text-[9px]">
                    {getInitials(annotation.author?.display_name ?? null)}
                </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
                {replyToAnnotation && (
                    <p className="mb-0.5 text-xs text-muted-foreground">
                        Replying to @{replyToAnnotation.author?.display_name ?? "[deleted]"}
                    </p>
                )}
                <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium">{authorName}</span>
                    <span className="text-[10px] text-muted-foreground">
                        {date.toLocaleDateString()}
                    </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-xs">
                    {annotation.body}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                    <button
                        onClick={() => onReply(annotation.id)}
                        className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                        <Reply className="h-3 w-3" />
                        Reply
                    </button>
                    {canEdit && (
                        <button
                            onClick={() => onEdit(annotation.id, annotation.body)}
                            className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            <Edit2 className="h-3 w-3" />
                            Edit
                        </button>
                    )}
                    {canDelete ? (
                        <ConfirmDeleteDialog
                            onConfirm={() => onDelete(annotation.id)}
                            title="Delete annotation"
                            description="Are you sure you want to delete this annotation? This action cannot be undone."
                        />
                    ) : (
                        <FlagButton
                            targetType="annotation"
                            targetId={annotation.id}
                            variant="ghost"
                            className="h-auto p-0 px-1 py-0.5 text-[10px] font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
                            iconClassName="h-3 w-3"
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

interface AnnotationThreadProps {
    thread: ThreadData;
    currentUserId: string | null;
    currentUserRole: string | null;
    onReply: (annotationId: string) => void;
    onEdit: (annotationId: string, body: string) => void;
    onDelete: (annotationId: string) => void;
}

export function AnnotationThread({
    thread,
    currentUserId,
    currentUserRole,
    onReply,
    onEdit,
    onDelete,
}: AnnotationThreadProps) {
    const allAnnotations = [thread.root, ...thread.replies];
    const annotationMap = new Map(allAnnotations.map((a) => [a.id, a]));

    return (
        <div className="rounded-md border bg-muted/20 p-2">
            {thread.root.selection_text && (
                <div className="mb-2 border-l-2 border-yellow-400/60 bg-yellow-50/50 px-2 py-1 dark:bg-yellow-900/20">
                    <p className="text-xs italic text-muted-foreground">
                        &ldquo;{thread.root.selection_text}&rdquo;
                    </p>
                </div>
            )}
            <AnnotationItem
                annotation={thread.root}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
            />
            {thread.replies.length > 0 && (
                <div className="ml-4 border-l pl-3">
                    {thread.replies.map((reply) => (
                        <AnnotationItem
                            key={reply.id}
                            annotation={reply}
                            currentUserId={currentUserId}
                            currentUserRole={currentUserRole}
                            onReply={onReply}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            replyToAnnotation={
                                reply.reply_to_id
                                    ? annotationMap.get(reply.reply_to_id)
                                    : undefined
                            }
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface AnnotationFormProps {
    onSubmit: (body: string) => Promise<void>;
    maxLength?: number;
    placeholder?: string;
    submitLabel?: string;
}

export function AnnotationForm({
    onSubmit,
    maxLength = 1000,
    placeholder = "Write an annotation...",
    submitLabel,
}: AnnotationFormProps) {
    const [body, setBody] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!body.trim() || submitting) return;
        setSubmitting(true);
        try {
            await onSubmit(body.trim());
            setBody("");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-2">
            <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, maxLength))}
                placeholder={placeholder}
                className="min-h-[60px] text-sm"
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit();
                    }
                }}
            />
            <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                    {body.length}/{maxLength}
                </span>
                <Button
                    size="sm"
                    onClick={handleSubmit}
                    disabled={submitting || !body.trim()}
                >
                    {submitLabel ?? <Send className="h-3.5 w-3.5" />}
                </Button>
            </div>
        </div>
    );
}

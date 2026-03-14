"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

interface AnnotationAuthor {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
}

export interface AnnotationData {
    id: string;
    material_id: string;
    version_id: string | null;
    author_id: string | null;
    author: AnnotationAuthor | null;
    body: string;
    page: number | null;
    selection_text: string | null;
    position_data: Record<string, unknown> | null;
    thread_id: string | null;
    reply_to_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface ThreadData {
    root: AnnotationData;
    replies: AnnotationData[];
}

interface PaginatedThreads {
    items: ThreadData[];
    total: number;
    page: number;
    pages: number;
}

export function useAnnotations(materialId: string | null) {
    const [threads, setThreads] = useState<ThreadData[]>([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);

    const fetchAnnotations = useCallback(
        async (p: number) => {
            if (!materialId) return;
            setLoading(true);
            try {
                const data = await apiFetch<PaginatedThreads>(
                    `/materials/${materialId}/annotations?page=${p}&limit=20`
                );
                setThreads(data.items);
                setPage(data.page);
                setPages(data.pages);
                setTotal(data.total);
            } catch {
                // silent
            } finally {
                setLoading(false);
            }
        },
        [materialId]
    );

    useEffect(() => {
        setThreads([]);
        setPage(1);
        if (materialId) fetchAnnotations(1);
    }, [materialId, fetchAnnotations]);

    // Subscribe to real-time annotation events for this material
    const pageRef = useRef(1);
    useEffect(() => { pageRef.current = page; }, [page]);

    useEffect(() => {
        if (!materialId) return;
        let es: EventSource | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let cancelled = false;

        function connect() {
            if (cancelled) return;
            es = new EventSource(`${API_BASE}/materials/${materialId}/sse`);
            es.addEventListener("annotation_created", () => {
                fetchAnnotations(pageRef.current);
            });
            es.addEventListener("annotation_deleted", () => {
                fetchAnnotations(pageRef.current);
            });
            es.onerror = () => {
                es?.close();
                if (!cancelled) {
                    reconnectTimer = setTimeout(connect, 5000);
                }
            };
        }

        connect();
        return () => {
            cancelled = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            es?.close();
        };
    }, [materialId, fetchAnnotations]);

    const createAnnotation = useCallback(
        async (body: string, selectionText?: string, positionData?: Record<string, unknown>, docPage?: number, replyToId?: string) => {
            if (!materialId) return null;
            const payload: Record<string, unknown> = { body };
            if (selectionText) payload.selection_text = selectionText;
            if (positionData) payload.position_data = positionData;
            if (docPage !== undefined) payload.page = docPage;
            if (replyToId) payload.reply_to_id = replyToId;

            const annotation = await apiFetch<AnnotationData>(
                `/materials/${materialId}/annotations`,
                {
                    method: "POST",
                    body: JSON.stringify(payload),
                }
            );
            await fetchAnnotations(page);
            return annotation;
        },
        [materialId, page, fetchAnnotations]
    );

    const editAnnotation = useCallback(
        async (annotationId: string, body: string) => {
            await apiFetch<AnnotationData>(`/annotations/${annotationId}`, {
                method: "PATCH",
                body: JSON.stringify({ body }),
            });
            await fetchAnnotations(page);
        },
        [page, fetchAnnotations]
    );

    const deleteAnnotation = useCallback(
        async (annotationId: string) => {
            await apiFetch<void>(`/annotations/${annotationId}`, {
                method: "DELETE",
            });
            await fetchAnnotations(page);
        },
        [page, fetchAnnotations]
    );

    return {
        threads,
        loading,
        page,
        pages,
        total,
        fetchAnnotations,
        createAnnotation,
        editAnnotation,
        deleteAnnotation,
    };
}

"use client";

import { useEffect, useRef } from "react";
import { getAccessToken } from "@/lib/auth-tokens";
import { useAuthStore, useNotificationStore } from "@/lib/stores";
import { apiFetch } from "@/lib/api-client";

const CHANNEL_NAME = "wikint-sse-leader";
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

interface UnreadResponse {
    total: number;
}

export function useSSE() {
    const { isAuthenticated } = useAuthStore();
    const { increment, setUnreadCount } = useNotificationStore();
    const eventSourceRef = useRef<EventSource | null>(null);
    const channelRef = useRef<BroadcastChannel | null>(null);
    const isLeaderRef = useRef(false);

    useEffect(() => {
        if (!isAuthenticated) return;

        apiFetch<UnreadResponse>("/notifications?read=false&limit=1")
            .then((data) => setUnreadCount(data.total))
            .catch(() => { });

        const channel = new BroadcastChannel(CHANNEL_NAME);
        channelRef.current = channel;

        channel.postMessage({ type: "leader-check" });

        const leaderTimeout = setTimeout(() => {
            isLeaderRef.current = true;
            connectSSE();
        }, 200);

        channel.onmessage = (event: MessageEvent) => {
            if (event.data?.type === "leader-check" && isLeaderRef.current) {
                channel.postMessage({ type: "leader-alive" });
            }
            if (event.data?.type === "leader-alive" && !isLeaderRef.current) {
                clearTimeout(leaderTimeout);
            }
            if (event.data?.type === "notification") {
                increment();
            }
        };

        function connectSSE() {
            const token = getAccessToken();
            if (!token) return;

            const es = new EventSource(
                `${API_BASE}/notifications/sse?token=${encodeURIComponent(token)}`
            );

            es.addEventListener("notification", () => {
                increment();
                channelRef.current?.postMessage({ type: "notification" });
            });

            es.onerror = () => {
                es.close();
                setTimeout(() => {
                    if (isLeaderRef.current) connectSSE();
                }, 5000);
            };

            eventSourceRef.current = es;
        }

        return () => {
            clearTimeout(leaderTimeout);
            isLeaderRef.current = false;
            eventSourceRef.current?.close();
            eventSourceRef.current = null;
            channel.close();
            channelRef.current = null;
        };
    }, [isAuthenticated, increment, setUnreadCount]);
}

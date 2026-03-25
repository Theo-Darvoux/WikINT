"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { ProfileView, ProfileSkeleton, type UserProfile } from "@/components/profile/profile-view";
import { API_BASE, apiFetch, getClientId } from "@/lib/api-client";
import { getAccessToken } from "@/lib/auth-tokens";
import { toast } from "sonner";

function OwnProfileContent() {
    const [profile, setProfile] = useState<UserProfile | null>(null);

    const fetchProfile = useCallback(async () => {
        try {
            const data = await apiFetch<UserProfile>("/users/me");
            setProfile(data);
        } catch {
            queueMicrotask(() => {
                toast.error("Failed to load profile");
            });
        }
    }, []);

    useEffect(() => {
        setTimeout(fetchProfile, 0);
    }, [fetchProfile]);

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const formData = new FormData();
            formData.append("file", file);

            const res = await fetch(`${API_BASE}/upload`, {
                method: "POST",
                body: formData,
                headers: {
                    ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
                    "X-Client-ID": getClientId(),
                },
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({ detail: "Upload failed" }));
                throw new Error(body.detail ?? "Upload failed");
            }
            const upload = await res.json() as { file_key: string };

            await apiFetch("/users/me", {
                method: "PATCH",
                body: JSON.stringify({ avatar_url: upload.file_key }),
            });

            toast.success("Avatar updated");
            fetchProfile();
        } catch {
            toast.error("Failed to upload avatar");
        }
    };

    if (!profile) return <ProfileSkeleton />;

    return (
        <ProfileView
            profile={profile}
            isOwn
            onAvatarUpload={handleAvatarUpload}
            onProfileUpdated={fetchProfile}
            showRecentlyViewed
        />
    );
}

export default function ProfilePage() {
    return (
        <AuthGuard requireOnboarded>
            <OwnProfileContent />
        </AuthGuard>
    );
}

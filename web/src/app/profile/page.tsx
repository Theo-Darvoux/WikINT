"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { ProfileView, ProfileSkeleton, type UserProfile } from "@/components/profile/profile-view";
import { apiFetch } from "@/lib/api-client";
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
            const upload = await apiFetch<{ upload_url: string; file_key: string }>(
                "/upload/request-url",
                {
                    method: "POST",
                    body: JSON.stringify({
                        filename: file.name,
                        size: file.size,
                        mime_type: file.type,
                    }),
                }
            );

            await fetch(upload.upload_url, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type },
            });

            await apiFetch("/upload/complete", {
                method: "POST",
                body: JSON.stringify({ file_key: upload.file_key }),
            });

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

"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminPRsRedirect() {
    const router = useRouter();
    useEffect(() => { router.replace("/moderator/pull-requests"); }, [router]);
    return null;
}

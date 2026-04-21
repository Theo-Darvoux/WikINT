"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminFeaturedRedirect() {
    const router = useRouter();
    useEffect(() => { router.replace("/moderator/featured"); }, [router]);
    return null;
}

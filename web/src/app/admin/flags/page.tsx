"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminFlagsRedirect() {
    const router = useRouter();
    useEffect(() => { router.replace("/moderator/flags"); }, [router]);
    return null;
}

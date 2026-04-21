"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminDirectoriesRedirect() {
    const router = useRouter();
    useEffect(() => { router.replace("/moderator/directories"); }, [router]);
    return null;
}

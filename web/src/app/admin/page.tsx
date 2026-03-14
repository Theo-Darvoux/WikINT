"use client";

import { useEffect, useState } from "react";
import { Users, FileText, GitPullRequest, Flag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

interface AdminStats {
    user_count: number;
    material_count: number;
    open_pr_count: number;
    open_flag_count: number;
}

export default function AdminDashboard() {
    const [stats, setStats] = useState<AdminStats | null>(null);

    useEffect(() => {
        apiFetch<AdminStats>("/admin/stats")
            .then(setStats)
            .catch(() => toast.error("Failed to load admin stats"));
    }, []);

    if (!stats) {
        return <div className="p-6 text-center text-muted-foreground">Loading...</div>;
    }

    const cards = [
        { title: "Total Users", value: stats.user_count, icon: Users },
        { title: "Materials", value: stats.material_count, icon: FileText },
        { title: "Open PRs", value: stats.open_pr_count, icon: GitPullRequest },
        { title: "Open Flags", value: stats.open_flag_count, icon: Flag },
    ];

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {cards.map((c) => {
                    const Icon = c.icon;
                    return (
                        <Card key={c.title}>
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">
                                    {c.title}
                                </CardTitle>
                                <Icon className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{c.value}</div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
            {/* Charts could be added here in the future via Recharts or Chart.js */}
        </div>
    );
}

"use client";

import { useEffect, useState } from "react";
import { Users, FileText, GitPullRequest, Flag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface ModeratorStats {
    user_count: number;
    material_count: number;
    open_pr_count: number;
    open_flag_count: number;
}

export default function ModeratorDashboard() {
    const t = useTranslations("Moderator.dashboard");
    const tCommon = useTranslations("Common");
    const [stats, setStats] = useState<ModeratorStats | null>(null);

    useEffect(() => {
        apiFetch<ModeratorStats>("/moderator/stats")
            .then(setStats)
            .catch(() => toast.error(t("stats.loadError")));
    }, [t]);

    if (!stats) {
        return <div className="p-6 text-center text-muted-foreground">{tCommon("loading")}</div>;
    }

    const cards = [
        { title: t("stats.userCount"), value: stats.user_count, icon: Users },
        { title: t("stats.materialCount"), value: stats.material_count, icon: FileText },
        { title: t("stats.openPrCount"), value: stats.open_pr_count, icon: GitPullRequest },
        { title: t("stats.openFlagCount"), value: stats.open_flag_count, icon: Flag },
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
        </div>
    );
}

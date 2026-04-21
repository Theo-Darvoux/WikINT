"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { 
    Users, 
    AlertTriangle, 
    Settings, 
    Database,
    HardDrive,
    Search,
    Cpu,
    ShieldCheck,
    Activity,
    ArrowRight,
    RefreshCw,
    Mail
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes } from "@/lib/utils";

// Types
interface ServiceStatus {
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
    latency_ms?: number;
    metadata?: Record<string, any>;
}

interface HealthData {
    status: string;
    timestamp: string;
    services: Record<string, ServiceStatus>;
    metrics: {
        total_users: number;
        total_materials: number;
        pending_jobs: number;
        max_upload_size_mb?: number;
        google_auth_enabled?: boolean;
    };
}

function StorageReconciliationModal() {
    const [reconciling, setReconciling] = useState(false);
    const [data, setData] = useState<any>(null);
    const [pruning, setPruning] = useState(false);

    const runReconcile = async () => {
        setReconciling(true);
        try {
            const res = await apiFetch<any>("/admin/storage/reconcile");
            setData(res);
        } catch (err) {
            console.error(err);
            toast.error("Reconciliation failed");
        } finally {
            setReconciling(false);
        }
    };

    const prune = async () => {
        if (!data?.orphans) return;
        const keys = [
            ...data.orphans.cas.map((o: any) => o.key),
            ...data.orphans.thumbnails.map((o: any) => o.key)
        ];
        
        if (keys.length === 0) {
            toast.info("No orphans to prune");
            return;
        }

        setPruning(true);
        try {
            await apiFetch("/admin/storage/prune", {
                method: "POST",
                body: JSON.stringify(keys)
            });
            toast.success(`Successfully pruned ${keys.length} objects`);
            setData(null);
        } catch (err) {
            console.error(err);
            toast.error("Pruning failed");
        } finally {
            setPruning(false);
        }
    };

    const totalOrphans = (data?.orphans?.cas?.length || 0) + (data?.orphans?.thumbnails?.length || 0);
    const totalMissing = (data?.missing?.cas?.length || 0) + (data?.missing?.thumbnails?.length || 0);

    return (
        <Dialog onOpenChange={(open) => !open && setData(null)}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-full mt-4 h-8 text-[11px] font-bold uppercase tracking-wider gap-2 hover:bg-primary/5 hover:text-primary transition-all">
                    <RefreshCw className={cn("h-3 w-3", reconciling && "animate-spin")} />
                    Integrity Check
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl bg-card border-muted">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <HardDrive className="h-5 w-5 text-primary" />
                        Storage Reconciliation
                    </DialogTitle>
                    <DialogDescription>
                        Compare S3-compatible storage with database records to find orphaned or missing files.
                    </DialogDescription>
                </DialogHeader>

                {!data ? (
                    <div className="py-12 flex flex-col items-center justify-center gap-4">
                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                            <Search className="h-6 w-6 text-primary" />
                        </div>
                        <div className="text-center">
                            <p className="text-sm font-medium text-foreground">Ready to scan storage</p>
                            <p className="text-xs text-muted-foreground">This will list all objects in your S3 bucket.</p>
                        </div>
                        <Button onClick={runReconcile} disabled={reconciling} className="gap-2">
                            {reconciling ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                            Start Scan
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="grid grid-cols-3 gap-4">
                            <div className="p-3 rounded-xl bg-muted/30 border border-muted/50">
                                <p className="text-[10px] font-bold uppercase text-muted-foreground/70">S3 Total</p>
                                <p className="text-lg font-bold">{formatBytes(data.stats.total_s3_bytes)}</p>
                                <p className="text-[10px] text-muted-foreground">{data.stats.total_s3_objects} objects</p>
                            </div>
                            <div className={cn("p-3 rounded-xl border", totalOrphans > 0 ? "bg-amber-500/5 border-amber-500/20" : "bg-muted/30 border-muted/50")}>
                                <p className="text-[10px] font-bold uppercase text-muted-foreground/70">Orphans</p>
                                <p className={cn("text-lg font-bold", totalOrphans > 0 && "text-amber-500")}>{formatBytes(data.stats.orphaned_bytes)}</p>
                                <p className="text-[10px] text-muted-foreground">{totalOrphans} unused files</p>
                            </div>
                            <div className={cn("p-3 rounded-xl border", totalMissing > 0 ? "bg-red-500/5 border-red-500/20" : "bg-muted/30 border-muted/50")}>
                                <p className="text-[10px] font-bold uppercase text-muted-foreground/70">Missing</p>
                                <p className={cn("text-lg font-bold", totalMissing > 0 && "text-red-500")}>{totalMissing}</p>
                                <p className="text-[10px] text-muted-foreground">Broken records</p>
                            </div>
                        </div>

                        {totalOrphans > 0 && (
                            <div className="space-y-2">
                                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Orphaned Files (Ready to Prune)</p>
                                <ScrollArea className="h-[200px] w-full rounded-md border border-muted/50 bg-muted/10 p-2">
                                    <div className="space-y-1">
                                        {data.orphans.cas.map((o: any) => (
                                            <div key={o.key} className="flex items-center justify-between p-2 rounded hover:bg-muted/20 transition-colors">
                                                <span className="text-xs font-mono text-muted-foreground truncate flex-1 mr-4">{o.key}</span>
                                                <Badge variant="outline" className="text-[9px]">{formatBytes(o.size)}</Badge>
                                            </div>
                                        ))}
                                        {data.orphans.thumbnails.map((o: any) => (
                                            <div key={o.key} className="flex items-center justify-between p-2 rounded hover:bg-muted/20 transition-colors">
                                                <span className="text-xs font-mono text-muted-foreground truncate flex-1 mr-4">{o.key}</span>
                                                <Badge variant="outline" className="text-[9px]">{formatBytes(o.size)}</Badge>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </div>
                        )}

                        {totalMissing > 0 && (
                            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/10">
                                <div className="flex items-center gap-2 text-red-500 mb-1">
                                    <AlertTriangle className="h-4 w-4" />
                                    <p className="text-xs font-bold uppercase">Critical Warnings</p>
                                </div>
                                <p className="text-[11px] text-red-500/80 leading-relaxed">
                                    {totalMissing} files are referenced in the database but missing from S3. These materials will fail to download/view.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2 sm:gap-0">
                    {data && totalOrphans > 0 && (
                        <Button variant="destructive" onClick={prune} disabled={pruning} className="gap-2">
                            {pruning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                            Prune Orphans
                        </Button>
                    )}
                    <Button variant="ghost" onClick={() => setData(null)} disabled={reconciling || pruning}>
                        Reset
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function AdminDashboard() {
    const [health, setHealth] = useState<HealthData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchHealth = async (showToast = false) => {
        setRefreshing(true);
        try {
            const data = await apiFetch<HealthData>("/admin/health");
            setHealth(data);
            if (showToast) toast.success("System status updated");
        } catch (err) {
            console.error("Failed to fetch health", err);
            if (showToast) toast.error("Failed to refresh status");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchHealth();
        const interval = setInterval(() => fetchHealth(false), 30000); // Auto-poll every 30s
        return () => clearInterval(interval);
    }, []);

    const sections = [
        {
            href: "/admin/users",
            icon: Users,
            title: "User Management",
            description: "Manage user roles and approve pending access requests.",
        },
        {
            href: "/admin/dlq",
            icon: AlertTriangle,
            title: "Dead Letter Queue",
            description: "Inspect failed background jobs, retry or dismiss them.",
        },
        {
            href: "/admin/config",
            icon: Settings,
            title: "Configuration",
            description: "Configure authentication, storage, and platform settings.",
        },
    ];

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="h-[180px] w-full animate-pulse rounded-2xl bg-muted" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <div key={i} className="h-[140px] animate-pulse rounded-xl bg-muted" />
                    ))}
                </div>
            </div>
        );
    }

    const getStatusBg = (status: string) => {
        switch (status) {
            case "healthy": return "bg-green-500/5 border-green-500/20";
            case "degraded": return "bg-amber-500/5 border-amber-500/20";
            case "unhealthy": return "bg-red-500/5 border-red-500/20";
            default: return "bg-muted";
        }
    };

    return (
        <div className="space-y-8 pb-10">
            {/* Global Status Banner */}
            <div className={cn(
                "relative overflow-hidden rounded-2xl border p-8 transition-all duration-500",
                getStatusBg(health?.status || "healthy")
            )}>
                <div className="absolute -right-12 -top-12 h-64 w-64 opacity-[0.03] dark:opacity-[0.05]">
                    <Activity className="h-full w-full" />
                </div>
                
                <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-2">
                        <div className="flex items-center gap-3">
                            <div className="relative flex h-3.5 w-3.5">
                                <span className={cn(
                                    "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                                    health?.status === "healthy" ? "bg-green-400" : health?.status === "degraded" ? "bg-amber-400" : "bg-red-400"
                                )}></span>
                                <span className={cn(
                                    "relative inline-flex h-3.5 w-3.5 rounded-full",
                                    health?.status === "healthy" ? "bg-green-500" : health?.status === "degraded" ? "bg-amber-500" : "bg-red-500"
                                )}></span>
                            </div>
                            <h1 className="text-3xl font-bold tracking-tight">
                                {health?.status === "healthy" ? "All Systems Operational" : health?.status === "degraded" ? "Partial Degradation" : "Service Disruption Detected"}
                            </h1>
                        </div>
                        <div className="flex items-center gap-4">
                            <p className="text-muted-foreground font-medium">
                                Last updated: {new Date(health?.timestamp || "").toLocaleTimeString()}
                            </p>
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-8 gap-2 rounded-full px-3 text-xs font-bold hover:bg-background/50"
                                onClick={() => fetchHealth(true)}
                                disabled={refreshing}
                            >
                                <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
                                {refreshing ? "Refreshing..." : "Refresh"}
                            </Button>
                        </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-4 md:gap-8">
                        <div className="space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Pending Jobs</p>
                            <p className="text-3xl font-black tabular-nums">{health?.metrics.pending_jobs || 0}</p>
                        </div>
                        <div className="hidden h-12 w-px bg-border/50 md:block" />
                        <div className="space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Total Users</p>
                            <p className="text-3xl font-black tabular-nums">{health?.metrics.total_users || 0}</p>
                        </div>
                        <div className="hidden h-12 w-px bg-border/50 md:block" />
                        <div className="space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Materials</p>
                            <p className="text-3xl font-black tabular-nums">{health?.metrics.total_materials || 0}</p>
                        </div>
                        <div className="hidden h-12 w-px bg-border/50 md:block" />
                        <div className="space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Max Upload</p>
                            <p className="text-3xl font-black tabular-nums">{health?.metrics.max_upload_size_mb || 0} MB</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Service Grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <ServiceCard 
                    name="Database" 
                    icon={Database} 
                    data={health?.services.database} 
                    description="Primary PostgreSQL storage"
                />
                <ServiceCard 
                    name="Redis" 
                    icon={Activity} 
                    data={health?.services.redis} 
                    description="Cache & event bus"
                />
                <ServiceCard 
                    name="S3 Storage" 
                    icon={HardDrive} 
                    data={health?.services.storage} 
                    description="Object & file storage"
                >
                    {health?.services.storage.metadata?.max_storage_bytes && (
                        <div className="mt-4 space-y-1.5">
                            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                                <span>Capacity Used</span>
                                <span>{Math.round(((health.services.storage.metadata.usage_bytes as number || 0) / (health.services.storage.metadata.max_storage_bytes as number)) * 100)}%</span>
                            </div>
                            <Progress 
                                value={((health.services.storage.metadata.usage_bytes as number || 0) / (health.services.storage.metadata.max_storage_bytes as number)) * 100} 
                                className="h-1.5 bg-muted"
                            />
                        </div>
                    )}
                    <StorageReconciliationModal />
                </ServiceCard>
                <ServiceCard 
                    name="Email (SMTP)" 
                    icon={Mail} 
                    data={health?.services.email} 
                    description="SMTP relay service"
                    metadata={[
                        { label: "Host", value: health?.services.email.metadata?.host },
                        { label: "User", value: health?.services.email.metadata?.user || "Anonymous" },
                        { label: "Google OAuth", value: health?.metrics.google_auth_enabled ? "Active" : "Disabled" }
                    ]}
                />
                <ServiceCard 
                    name="Search" 
                    icon={Search} 
                    data={health?.services.search} 
                    description="MeiliSearch indexing"
                />
                <ServiceCard 
                    name="Workers" 
                    icon={Cpu} 
                    data={health?.services.workers} 
                    description="ARQ background pipeline"
                />
                <ServiceCard 
                    name="Scanner" 
                    icon={ShieldCheck} 
                    data={health?.services.scanner} 
                    description="YARA malware engine"
                    metadata={[
                        { label: "YARA", value: health?.services.scanner.metadata?.yara_enabled ? "Ready" : "Offline" },
                        { label: "Bazaar", value: health?.services.scanner.metadata?.malwarebazaar_enabled ? "Enabled" : "Disabled" },
                        { label: "Pending", value: health?.services.scanner.metadata?.pending_scans || 0 }
                    ]}
                />
            </div>

            {/* Quick Links / Navigation */}
            <div className="space-y-6 pt-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold tracking-tight">Administrative Sections</h3>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                    {sections.map((s) => (
                        <Link key={s.href} href={s.href} className="group">
                            <Card className="h-full border-2 border-transparent transition-all duration-300 group-hover:border-primary/20 group-hover:bg-primary/[0.02] group-hover:shadow-lg">
                                <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                                            <s.icon className="h-5 w-5" />
                                        </div>
                                        <ArrowRight className="h-5 w-5 opacity-0 transition-all -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0" />
                                    </div>
                                    <CardTitle className="mt-4 text-lg font-bold group-hover:text-primary transition-colors">{s.title}</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <CardDescription className="text-sm font-medium leading-relaxed group-hover:text-foreground/70">{s.description}</CardDescription>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}

function ServiceCard({ 
    name, 
    icon: Icon, 
    data, 
    description,
    metadata,
    children
}: { 
    name: string, 
    icon: React.ComponentType<{ className?: string }>, 
    data?: ServiceStatus, 
    description: string,
    metadata?: { label: string, value: string | number | undefined }[],
    children?: React.ReactNode
}) {
    return (
        <Card className="group relative overflow-hidden bg-card/40 transition-all hover:bg-card/60">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-muted p-2 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                            <Icon className="h-5 w-5" />
                        </div>
                        <div>
                            <CardTitle className="text-base">{name}</CardTitle>
                            <CardDescription className="text-[10px] uppercase tracking-wider">{description}</CardDescription>
                        </div>
                    </div>
                    <div className={cn(
                        "h-2 w-2 rounded-full",
                        data?.status === "healthy" ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : 
                        data?.status === "degraded" ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" : 
                        "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                    )} />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Current Status</span>
                    <Badge variant={data?.status === "healthy" ? "default" : data?.status === "degraded" ? "secondary" : "destructive"} className="h-5 text-[10px] font-black uppercase tracking-tighter">
                        {data?.status || "Unknown"}
                    </Badge>
                </div>
                
                {typeof data?.latency_ms === "number" ? (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Response Time</span>
                            <span className="text-xs font-black tabular-nums">{data.latency_ms.toFixed(1)}ms</span>
                        </div>
                        <Progress 
                            value={Math.min(100, (data.latency_ms / 200) * 100)} 
                            className="h-1.5 bg-muted"
                        />
                    </div>
                ) : (
                    <div className="h-[34px] flex items-center">
                         <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 italic">No latency metrics</span>
                    </div>
                )}

                {/* Metadata Details */}
                {data?.metadata && Object.keys(data.metadata).length > 0 && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-muted/50">
                        {data.metadata.usage_bytes !== undefined && (
                            <div className="space-y-0.5">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground/70">Storage Usage</p>
                                <p className="text-xs font-bold">{formatBytes(data.metadata.usage_bytes)}</p>
                            </div>
                        )}
                        {data.metadata.active_queues !== undefined && (
                            <div className="space-y-1.5 col-span-2">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground/70">Pool Status</p>
                                <div className="flex flex-col gap-1.5">
                                    {(data.metadata.active_queues as string[]).map(q => {
                                        const counts = data.metadata?.queue_counts as Record<string, number> | undefined;
                                        const count = counts?.[q] || 0;
                                        return (
                                            <div key={q} className="flex items-center justify-between group/q">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="h-1 w-1 rounded-full bg-green-500" />
                                                    <span className="text-[11px] font-bold text-foreground/80">{q.replace('arq:', '')}</span>
                                                </div>
                                                <Badge variant="outline" className={cn(
                                                    "h-4 text-[9px] px-1.5 font-bold transition-colors",
                                                    count > 0 ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-muted text-muted-foreground border-transparent"
                                                )}>
                                                    {count} {count === 1 ? 'job' : 'jobs'}
                                                </Badge>
                                            </div>
                                        );
                                    })}
                                    {(data.metadata.missing_queues as string[])?.map(q => (
                                        <div key={q} className="flex items-center justify-between opacity-60">
                                            <div className="flex items-center gap-1.5">
                                                <div className="h-1 w-1 rounded-full bg-red-500" />
                                                <span className="text-[11px] font-bold text-red-500">{q.replace('arq:', '')}</span>
                                            </div>
                                            <span className="text-[9px] font-bold uppercase text-red-500/70">Offline</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {data.metadata.active_workers !== undefined && (
                            <div className="space-y-0.5">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground/70">Active Workers</p>
                                <p className="text-xs font-bold">{data.metadata.active_workers}</p>
                            </div>
                        )}
                        {data.metadata.pending_scans !== undefined && (
                            <div className="space-y-0.5">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground/70">Pending Scans</p>
                                <p className={cn("text-xs font-bold", data.metadata.pending_scans > 0 && "text-amber-500")}>
                                    {data.metadata.pending_scans}
                                </p>
                            </div>
                        )}
                        {data.metadata.yara_enabled !== undefined && (
                            <div className="space-y-0.5">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground/70">YARA Engine</p>
                                <p className="text-xs font-bold text-green-500">Initialized</p>
                            </div>
                        )}
                        {data.metadata.malwarebazaar_enabled !== undefined && (
                            <div className="space-y-0.5">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground/70">Bazaar API</p>
                                <p className={cn("text-xs font-bold", data.metadata.malwarebazaar_enabled ? "text-green-500" : "text-muted-foreground")}>
                                    {data.metadata.malwarebazaar_enabled ? "Active" : "Disabled"}
                                </p>
                            </div>
                        )}
                        {data.metadata.max_storage_bytes !== undefined && (
                            <div className="space-y-0.5">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground/70">Storage Limit</p>
                                <p className="text-xs font-bold">{(data.metadata.max_storage_bytes as number) / (1024*1024*1024)} GB</p>
                            </div>
                        )}
                        {data.metadata.bucket && (
                            <div className="space-y-0.5">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground/70">Bucket</p>
                                <p className="text-xs font-mono opacity-80 truncate">{data.metadata.bucket}</p>
                            </div>
                        )}
                        {data.metadata.ssl !== undefined && (
                            <div className="space-y-0.5">
                                <p className="text-[9px] font-bold uppercase text-muted-foreground/70">SSL</p>
                                <p className="text-xs font-bold">{data.metadata.ssl ? "Enabled" : "Disabled"}</p>
                            </div>
                        )}
                    </div>
                )}
                
                {data?.status !== "healthy" && data?.message && (
                    <div className="rounded-lg bg-destructive/5 p-2 border border-destructive/10">
                        <p className="text-[10px] text-destructive font-bold leading-tight line-clamp-2">
                            {data.message}
                        </p>
                    </div>
                )}

                {metadata && metadata.length > 0 && (
                    <div className="grid grid-cols-2 gap-y-3 pt-2">
                        {metadata.map((item, idx) => (
                            <div key={idx} className="space-y-1">
                                <span className="block text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{item.label}</span>
                                <span className="block text-[11px] font-black truncate pr-2" title={String(item.value)}>
                                    {item.value || "—"}
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                {children}

                {data?.status === "unhealthy" && data.message && (
                    <div className="mt-2 rounded-md bg-red-500/10 p-2 text-[10px] font-medium text-red-500 border border-red-500/20">
                        {data.message}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

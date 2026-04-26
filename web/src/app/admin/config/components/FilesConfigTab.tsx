"use client";

import { useState, useEffect, useMemo } from "react";
import { 
    Settings2, HardDrive, FileCode, Sliders, Shield, 
    Loader2, Save, Info, Image as ImageIcon, FileText, Code2, RefreshCw,
    Search, CheckSquare, Square
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { TagInput } from "@/components/ui/tag-input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useTranslations } from "next-intl";

interface AuthConfig {
    max_file_size_mb: number;
    max_image_size_mb: number;
    max_audio_size_mb: number;
    max_video_size_mb: number;
    max_document_size_mb: number;
    max_office_size_mb: number;
    max_text_size_mb: number;
    pdf_quality: number | null;
    video_compression_profile: string | null;
    thumbnail_quality: number | null;
    thumbnail_size_px: number | null;
    allowed_extensions: string | null;
    allowed_mime_types: string | null;
}

interface FilesConfigTabProps {
    config: AuthConfig;
    saving: boolean;
    patchConfig: (patch: Partial<AuthConfig>) => Promise<void>;
}

interface FileFormat {
    id: string;
    label: string;
    extensions: string[];
    mimes: string[];
}

interface FileGroup {
    name: string;
    icon: any;
    formats: FileFormat[];
}

const FILE_GROUPS: FileGroup[] = [
    {
        name: "Images",
        icon: ImageIcon,
        formats: [
            { id: "jpeg", label: "JPEG / JPG", extensions: [".jpg", ".jpeg"], mimes: ["image/jpeg"] },
            { id: "png", label: "PNG", extensions: [".png"], mimes: ["image/png"] },
            { id: "webp", label: "WebP", extensions: [".webp"], mimes: ["image/webp"] },
            { id: "gif", label: "GIF", extensions: [".gif"], mimes: ["image/gif"] },
            { id: "svg", label: "SVG", extensions: [".svg"], mimes: ["image/svg+xml"] },
        ]
    },
    {
        name: "Documents",
        icon: FileText,
        formats: [
            { id: "pdf", label: "PDF", extensions: [".pdf"], mimes: ["application/pdf"] },
            { id: "epub", label: "ePUB", extensions: [".epub"], mimes: ["application/epub+zip"] },
            { id: "djvu", label: "DjVu", extensions: [".djvu", ".djv"], mimes: ["image/vnd.djvu", "image/x-djvu"] },
        ]
    },
    {
        name: "Office",
        icon: FileText,
        formats: [
            { id: "word", label: "Word (.docx, .doc)", extensions: [".docx", ".doc"], mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"] },
            { id: "excel", label: "Excel (.xlsx, .xls)", extensions: [".xlsx", ".xls"], mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"] },
            { id: "powerpoint", label: "PowerPoint (.pptx, .ppt)", extensions: [".pptx", ".ppt"], mimes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.ms-powerpoint"] },
            { id: "odt", label: "OpenDocument Text (.odt)", extensions: [".odt"], mimes: ["application/vnd.oasis.opendocument.text"] },
            { id: "ods", label: "OpenDocument Sheet (.ods)", extensions: [".ods"], mimes: ["application/vnd.oasis.opendocument.spreadsheet"] },
        ]
    },
    {
        name: "Code & Development",
        icon: Code2,
        formats: [
            { id: "markdown", label: "Markdown (.md, .markdown)", extensions: [".md", ".markdown"], mimes: ["text/markdown", "text/x-markdown"] },
            { id: "python", label: "Python (.py)", extensions: [".py", ".pyw", ".pyi"], mimes: ["text/x-python", "application/x-python"] },
            { id: "javascript", label: "JS / TS", extensions: [".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx"], mimes: ["text/javascript", "application/javascript", "application/typescript", "text/typescript"] },
            { id: "web", label: "Web (HTML, CSS)", extensions: [".html", ".htm", ".css", ".scss", ".sass"], mimes: ["text/html", "text/css"] },
            { id: "c_cpp", label: "C / C++", extensions: [".c", ".h", ".cpp", ".cxx", ".cc", ".hpp", ".hxx"], mimes: ["text/x-c", "text/x-csrc", "text/x-chdr", "text/x-c++", "text/x-c++src", "text/x-c++hdr"] },
            { id: "rust_go", label: "Rust & Go", extensions: [".rs", ".go"], mimes: ["text/x-rust", "text/x-go"] },
            { id: "java_jvm", label: "Java / Kotlin / JVM", extensions: [".java", ".kt", ".kts", ".scala", ".groovy"], mimes: ["text/x-java-source", "text/x-java", "text/x-kotlin", "text/x-scala"] },
            { id: "shell", label: "Shell Scripts", extensions: [".sh", ".bash", ".zsh", ".ps1"], mimes: ["text/x-shellscript", "application/x-sh", "application/x-bash", "text/x-powershell"] },
            { id: "data", label: "Data (JSON, XML, YAML, SQL)", extensions: [".json", ".json5", ".xml", ".yaml", ".yml", ".toml", ".sql"], mimes: ["application/json", "application/xml", "text/xml", "application/x-yaml", "text/yaml", "application/toml", "application/sql", "text/x-sql"] },
            { id: "latex", label: "TeX / LaTeX", extensions: [".tex", ".latex", ".sty", ".cls", ".bib"], mimes: ["application/x-tex", "text/x-tex"] },
        ]
    },
    {
        name: "Audio & Video",
        icon: RefreshCw,
        formats: [
            { id: "mp4", label: "MP4 Video", extensions: [".mp4"], mimes: ["video/mp4"] },
            { id: "webm", label: "WebM Video", extensions: [".webm"], mimes: ["video/webm"] },
            { id: "mp3", label: "MP3 Audio", extensions: [".mp3"], mimes: ["audio/mpeg", "audio/mp3"] },
            { id: "wav", label: "WAV Audio", extensions: [".wav"], mimes: ["audio/wav"] },
            { id: "ogg", label: "OGG (Audio/Video)", extensions: [".ogg"], mimes: ["audio/ogg", "video/ogg"] },
            { id: "flac", label: "FLAC Audio", extensions: [".flac"], mimes: ["audio/flac"] },
            { id: "aac", label: "AAC Audio", extensions: [".aac", ".m4a"], mimes: ["audio/aac", "audio/mp4"] },
        ]
    }
];

function SliderInput({ 
    label, 
    value, 
    onChange, 
    min = 1, 
    max = 100, 
    step = 1, 
    suffix = "",
    tooltip
}: { 
    label: string; 
    value: number | null; 
    onChange: (val: number) => void; 
    min?: number; 
    max?: number; 
    step?: number; 
    suffix?: string;
    tooltip?: string;
}) {
    return (
        <div className="space-y-3 p-4 rounded-xl bg-muted/30 border border-muted/50 hover:border-primary/20 transition-colors">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Label className="text-sm font-semibold">{label}</Label>
                    {tooltip && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[200px]">
                                    {tooltip}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </div>
                <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full shadow-sm">
                    {value ?? min}{suffix}
                </span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value ?? min}
                onChange={(e) => onChange(parseInt(e.target.value))}
                className="w-full h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary hover:accent-primary/80 transition-all"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground font-medium px-0.5">
                <span>{min}{suffix}</span>
                <span>{max}{suffix}</span>
            </div>
        </div>
    );
}

export function FilesConfigTab({ config, saving, patchConfig }: FilesConfigTabProps) {
    const t = useTranslations("Admin.Config.Files");
    const [filesForm, setFilesForm] = useState<Partial<AuthConfig>>({});
    const [isFilesModified, setIsFilesModified] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        setFilesForm({ ...config });
        setIsFilesModified(false);
    }, [config]);

    const handleSave = async () => {
        await patchConfig(filesForm);
        toast.success(t("success"));
        setIsFilesModified(false);
    };

    const handleDiscard = () => {
        setFilesForm({ ...config });
        setIsFilesModified(false);
    };

    const currentExtensions = useMemo(() => 
        new Set(filesForm.allowed_extensions?.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) || []),
    [filesForm.allowed_extensions]);

    const currentMimes = useMemo(() => 
        new Set(filesForm.allowed_mime_types?.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) || []),
    [filesForm.allowed_mime_types]);

    const toggleFormat = (format: FileFormat) => {
        const newExts = new Set(currentExtensions);
        const newMimes = new Set(currentMimes);
        
        const isCurrentlyActive = format.extensions.every(e => newExts.has(e.toLowerCase()));
        
        if (isCurrentlyActive) {
            format.extensions.forEach(e => newExts.delete(e.toLowerCase()));
            format.mimes.forEach(m => newMimes.delete(m.toLowerCase()));
        } else {
            format.extensions.forEach(e => newExts.add(e.toLowerCase()));
            format.mimes.forEach(m => newMimes.add(m.toLowerCase()));
        }
        
        setFilesForm(prev => ({
            ...prev,
            allowed_extensions: Array.from(newExts).join(", "),
            allowed_mime_types: Array.from(newMimes).join(", ")
        }));
        setIsFilesModified(true);
    };

    const toggleGroup = (group: FileGroup, forceState?: boolean) => {
        const newExts = new Set(currentExtensions);
        const newMimes = new Set(currentMimes);
        
        const allActive = group.formats.every(f => 
            f.extensions.every(e => newExts.has(e.toLowerCase()))
        );
        
        const targetState = forceState !== undefined ? forceState : !allActive;
        
        group.formats.forEach(f => {
            if (targetState) {
                f.extensions.forEach(e => newExts.add(e.toLowerCase()));
                f.mimes.forEach(m => newMimes.add(m.toLowerCase()));
            } else {
                f.extensions.forEach(e => newExts.delete(e.toLowerCase()));
                f.mimes.forEach(m => newMimes.delete(m.toLowerCase()));
            }
        });
        
        setFilesForm(prev => ({
            ...prev,
            allowed_extensions: Array.from(newExts).join(", "),
            allowed_mime_types: Array.from(newMimes).join(", ")
        }));
        setIsFilesModified(true);
    };

    const filteredGroups = useMemo(() => {
        if (!searchQuery) return FILE_GROUPS;
        return FILE_GROUPS.map(group => ({
            ...group,
            formats: group.formats.filter(f => 
                f.label.toLowerCase().includes(searchQuery.toLowerCase()) || 
                f.extensions.some(e => e.toLowerCase().includes(searchQuery.toLowerCase()))
            )
        })).filter(group => group.formats.length > 0);
    }, [searchQuery]);

    const isFormatActive = (format: FileFormat) => 
        format.extensions.every(e => currentExtensions.has(e.toLowerCase()));

    const isGroupFullyActive = (group: FileGroup) => 
        group.formats.every(f => isFormatActive(f));

    return (
        <TabsContent value="files" className="mt-6 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* File Size Limits */}
            <Card className="overflow-hidden border-none shadow-xl bg-card/50 backdrop-blur-sm">
                <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent border-b pb-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-primary/10 rounded-xl">
                            <Settings2 className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">{t("limits.title")}</CardTitle>
                            <CardDescription>
                                {t("limits.description")}
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-8">
                    <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
                        {[
                            { id: "max_file_size_mb", label: t("limits.global"), icon: HardDrive, color: "text-blue-500" },
                            { id: "max_image_size_mb", label: t("limits.images"), icon: ImageIcon, color: "text-purple-500" },
                            { id: "max_video_size_mb", label: t("limits.video"), icon: FileCode, color: "text-red-500" },
                            { id: "max_audio_size_mb", label: t("limits.audio"), icon: RefreshCw, color: "text-amber-500" },
                            { id: "max_document_size_mb", label: t("limits.document"), icon: FileText, color: "text-emerald-500" },
                            { id: "max_office_size_mb", label: t("limits.office"), icon: FileText, color: "text-orange-500" },
                            { id: "max_text_size_mb", label: t("limits.text"), icon: Code2, color: "text-indigo-500" },
                        ].map((item) => (
                            <div key={item.id} className="group space-y-3 p-4 rounded-xl bg-muted/20 border border-transparent hover:border-primary/20 hover:bg-muted/30 transition-all duration-200">
                                <Label htmlFor={item.id} className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                    <item.icon className={`h-3.5 w-3.5 ${item.color}`} />
                                    {item.label}
                                </Label>
                                <div className="relative">
                                    <Input
                                        id={item.id}
                                        type="number"
                                        className="h-11 pl-4 pr-12 font-mono text-lg bg-background/50 border-muted-foreground/20 focus:ring-primary/20 focus:border-primary/50 transition-all rounded-lg"
                                        value={filesForm[item.id as keyof AuthConfig] ?? ""}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value) || 0;
                                            setFilesForm((prev) => ({ ...prev, [item.id]: val }));
                                            setIsFilesModified(true);
                                        }}
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground/60">MB</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Processing & Compression */}
            <Card className="overflow-hidden border-none shadow-xl bg-card/50 backdrop-blur-sm">
                <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent border-b pb-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-primary/10 rounded-xl">
                            <Sliders className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">{t("processing.title")}</CardTitle>
                            <CardDescription>
                                {t("processing.description")}
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-8 space-y-10">
                    <div className="grid gap-8 md:grid-cols-2">
                        <SliderInput 
                            label={t("processing.pdfQuality")} 
                            value={filesForm.pdf_quality ?? 80}
                            onChange={(val) => {
                                setFilesForm(prev => ({ ...prev, pdf_quality: val }));
                                setIsFilesModified(true);
                            }}
                            tooltip={t("processing.pdfQualityTooltip")}
                            suffix="%"
                        />
                        
                        <div className="space-y-3 p-4 rounded-xl bg-muted/30 border border-muted/50">
                            <div className="flex items-center gap-2">
                                <Label htmlFor="video_compression" className="text-sm font-semibold">
                                    {t("processing.videoProfile")}
                                </Label>
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-[250px]">
                                            {t("processing.videoProfileTooltip")}
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                            <select
                                id="video_compression"
                                className="w-full h-11 rounded-lg border border-muted-foreground/20 bg-background/50 px-4 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all appearance-none cursor-pointer"
                                value={filesForm.video_compression_profile || "balanced"}
                                onChange={(e) => {
                                    setFilesForm((prev) => ({ ...prev, video_compression_profile: e.target.value }));
                                    setIsFilesModified(true);
                                }}
                            >
                                <option value="fast">{t("processing.videoProfiles.fast")}</option>
                                <option value="balanced">{t("processing.videoProfiles.balanced")}</option>
                                <option value="thorough">{t("processing.videoProfiles.thorough")}</option>
                            </select>
                        </div>

                        <SliderInput 
                            label={t("processing.thumbnailQuality")} 
                            value={filesForm.thumbnail_quality ?? 80}
                            onChange={(val) => {
                                setFilesForm(prev => ({ ...prev, thumbnail_quality: val }));
                                setIsFilesModified(true);
                            }}
                            tooltip={t("processing.thumbnailQualityTooltip")}
                            suffix="%"
                        />

                        <SliderInput 
                            label={t("processing.thumbnailSize")} 
                            min={100}
                            max={1280}
                            step={20}
                            value={filesForm.thumbnail_size_px ?? 400}
                            onChange={(val) => {
                                setFilesForm(prev => ({ ...prev, thumbnail_size_px: val }));
                                setIsFilesModified(true);
                            }}
                            tooltip={t("processing.thumbnailSizeTooltip")}
                            suffix="px"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Whitelisting */}
            <Card className="overflow-hidden border-none shadow-xl bg-card/50 backdrop-blur-sm">
                <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent border-b pb-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-primary/10 rounded-xl">
                                <Shield className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <CardTitle className="text-xl">{t("whitelist.title")}</CardTitle>
                                <CardDescription>
                                    {t("whitelist.description")}
                                </CardDescription>
                            </div>
                        </div>
                        <div className="relative w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder={t("whitelist.search")}
                                className="pl-9 h-10 bg-background/50 border-muted-foreground/20"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="flex border-b bg-muted/30 px-8 py-3 gap-4">
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-8 text-xs font-bold gap-2 rounded-full"
                            onClick={() => FILE_GROUPS.forEach(g => toggleGroup(g, true))}
                        >
                            <CheckSquare className="h-3.5 w-3.5" /> {t("whitelist.selectAll")}
                        </Button>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-8 text-xs font-bold gap-2 rounded-full"
                            onClick={() => FILE_GROUPS.forEach(g => toggleGroup(g, false))}
                        >
                            <Square className="h-3.5 w-3.5" /> {t("whitelist.deselectAll")}
                        </Button>
                    </div>
                    
                    <Accordion type="multiple" className="px-8 py-4" defaultValue={["Images", "Documents"]}>
                        {filteredGroups.map((group) => (
                            <AccordionItem key={group.name} value={group.name} className="border-muted-foreground/10">
                                <AccordionTrigger className="hover:no-underline py-6">
                                    <div className="flex items-center gap-4 w-full text-left">
                                        <div className="p-2 bg-muted rounded-lg">
                                            <group.icon className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                        <span className="font-bold text-base">{t(`whitelist.groups.${group.name}` as any)}</span>
                                        <div className="ml-auto mr-4">
                                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                                {group.formats.filter(f => isFormatActive(f)).length} / {group.formats.length}
                                            </span>
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="pb-8">
                                    <div className="flex justify-end mb-4 px-1">
                                        <Button 
                                            variant="ghost" 
                                            size="sm" 
                                            className="h-8 text-[10px] font-bold uppercase tracking-wider px-3 rounded-full hover:bg-primary/10 hover:text-primary"
                                            onClick={() => toggleGroup(group)}
                                        >
                                            {isGroupFullyActive(group) ? t("whitelist.deselectCategory") : t("whitelist.selectCategory")}
                                        </Button>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-4 pt-2 px-1">
                                        {group.formats.map((format) => (
                                            <div key={format.id} className="flex items-center space-x-3 py-1">
                                                <Checkbox 
                                                    id={format.id} 
                                                    checked={isFormatActive(format)}
                                                    onCheckedChange={() => toggleFormat(format)}
                                                />
                                                <div className="grid gap-1.5 leading-none">
                                                    <label
                                                        htmlFor={format.id}
                                                        className="text-sm font-medium leading-none cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                    >
                                                        {format.label}
                                                    </label>
                                                    <p className="text-[10px] text-muted-foreground font-mono">
                                                        {format.extensions.join(", ")}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>

                    <div className="p-8 border-t border-muted/50 bg-muted/10 space-y-4">
                        <div className="flex items-center gap-2">
                            <Label className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{t("whitelist.overrides")}</Label>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t("whitelist.overridesTooltip")}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        
                        <div className="grid gap-6 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-bold uppercase text-muted-foreground/60">{t("whitelist.extensions")}</Label>
                                <TagInput 
                                    tags={filesForm.allowed_extensions ? filesForm.allowed_extensions.split(",").map(s => s.trim()).filter(Boolean) : []}
                                    onChange={(tags) => {
                                        setFilesForm(prev => ({ ...prev, allowed_extensions: tags.join(", ") }));
                                        setIsFilesModified(true);
                                    }}
                                    placeholder={t("whitelist.extensionsPlaceholder")}
                                    maxTags={1000}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-bold uppercase text-muted-foreground/60">{t("whitelist.mimes")}</Label>
                                <TagInput 
                                    tags={filesForm.allowed_mime_types ? filesForm.allowed_mime_types.split(",").map(s => s.trim()).filter(Boolean) : []}
                                    onChange={(tags) => {
                                        setFilesForm(prev => ({ ...prev, allowed_mime_types: tags.join(", ") }));
                                        setIsFilesModified(true);
                                    }}
                                    placeholder={t("whitelist.mimesPlaceholder")}
                                    maxTags={1000}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="p-8 flex justify-end gap-3 border-t border-muted/50 bg-card">
                        {isFilesModified && (
                            <Button 
                                variant="ghost" 
                                onClick={handleDiscard}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                {t("discard")}
                            </Button>
                        )}
                        <Button 
                            onClick={handleSave}
                            disabled={saving || (!isFilesModified && !!config)}
                            className="gap-2 px-10 h-11 text-sm font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all rounded-xl"
                        >
                            {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4" />
                            )}
                            {t("save")}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </TabsContent>
    );
}

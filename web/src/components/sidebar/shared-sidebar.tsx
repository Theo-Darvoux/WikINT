"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUIStore, type SidebarTab } from "@/lib/stores";
import { useIsDesktop } from "@/hooks/use-media-query";
import { FloatingPanel } from "@/components/sidebar/floating-panel";
import { DetailsTab } from "@/components/sidebar/details-tab";
import { ChatTab } from "@/components/sidebar/chat-tab";
import { ActionsTab } from "@/components/sidebar/actions-tab";
import { EditsTab } from "@/components/sidebar/edits-tab";
import { AnnotationsTab } from "@/components/sidebar/annotations-tab";
const TAB_CONFIG: { value: SidebarTab; label: string }[] = [
    { value: "details", label: "Details" },
    { value: "chat", label: "Chat" },
    { value: "annotations", label: "Annotations" },
    { value: "edits", label: "Edits" },
    { value: "actions", label: "Actions" },
];

function SidebarContent() {
    const { sidebarTab, setSidebarTab, sidebarTarget } = useUIStore();
    return (
        <Tabs
            value={sidebarTab}
            onValueChange={(v) => setSidebarTab(v as SidebarTab)}
            className="flex h-full flex-col"
        >
            <TabsList
                variant="line"
                className="w-full shrink-0 justify-start gap-0 border-b px-0.5"
            >
                {TAB_CONFIG.map((tab) => (
                    <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        className="px-2.5 py-2 text-xs"
                    >
                        {tab.label}
                    </TabsTrigger>
                ))}
            </TabsList>
            <div className="flex-1 min-h-0 relative">
                <TabsContent value="details" className="absolute inset-0 m-0 flex flex-col">
                    <ScrollArea className="flex-1 min-h-0">
                        <div className="p-4">
                            <DetailsTab target={sidebarTarget} />
                        </div>
                    </ScrollArea>
                </TabsContent>
                <TabsContent value="chat" className="absolute inset-0 m-0 flex flex-col">
                    <ChatTab target={sidebarTarget} />
                </TabsContent>
                <TabsContent value="annotations" className="absolute inset-0 m-0 flex flex-col">
                    <AnnotationsTab target={sidebarTarget} />
                </TabsContent>
                <TabsContent value="edits" className="absolute inset-0 m-0 flex flex-col">
                    <ScrollArea className="flex-1 min-h-0">
                        <div className="p-4">
                            <EditsTab target={sidebarTarget} />
                        </div>
                    </ScrollArea>
                </TabsContent>
                <TabsContent value="actions" className="absolute inset-0 m-0 flex flex-col">
                    <ActionsTab target={sidebarTarget} />
                </TabsContent>
            </div>
        </Tabs>
    );
}


export function SharedSidebar() {
    const { sidebarOpen, closeSidebar } = useUIStore();
    const isDesktop = useIsDesktop();

    if (!sidebarOpen) return null;

    if (isDesktop) {
        return <SidebarContent />;
    }

    return (
        <FloatingPanel open={sidebarOpen} onClose={closeSidebar}>
            <SidebarContent />
        </FloatingPanel>
    );
}

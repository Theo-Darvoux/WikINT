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
    const isDesktop = useIsDesktop();

    const visibleTabs = TAB_CONFIG.filter((tab) => {
        if (tab.value === "annotations" && !isDesktop) return false;
        return true;
    });

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
                {visibleTabs.map((tab) => (
                    <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        className="px-2.5 py-2 text-xs"
                    >
                        {tab.label}
                    </TabsTrigger>
                ))}
            </TabsList>
            <ScrollArea className="flex-1">
                <TabsContent value="details" className="mt-0 p-4">
                    <DetailsTab target={sidebarTarget} />
                </TabsContent>
                <TabsContent value="chat" className="mt-0 p-4">
                    <ChatTab target={sidebarTarget} />
                </TabsContent>
                {isDesktop && (
                    <TabsContent value="annotations" className="mt-0 p-4">
                        <AnnotationsTab target={sidebarTarget} />
                    </TabsContent>
                )}
                <TabsContent value="edits" className="mt-0 p-4">
                    <EditsTab target={sidebarTarget} />
                </TabsContent>
                <TabsContent value="actions" className="mt-0 p-4">
                    <ActionsTab target={sidebarTarget} />
                </TabsContent>
            </ScrollArea>
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

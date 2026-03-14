"use client";

import { useIsDesktop } from "@/hooks/use-media-query";
import { useUIStore } from "@/lib/stores";
import { FloatingPanel } from "@/components/sidebar/floating-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DetailsTab } from "@/components/sidebar/details-tab";
import { ChatTab } from "@/components/sidebar/chat-tab";
import { ActionsTab } from "@/components/sidebar/actions-tab";
import { EditsTab } from "@/components/sidebar/edits-tab";
import type { SidebarTab } from "@/lib/stores";

const TAB_CONFIG: { value: SidebarTab; label: string }[] = [
    { value: "details", label: "Details" },
    { value: "edits", label: "Edits" },
    { value: "chat", label: "Chat" },
    { value: "actions", label: "Actions" },
];

export function GlobalFloatingSidebar() {
    const isDesktop = useIsDesktop();
    const { sidebarOpen, closeSidebar, sidebarTab, setSidebarTab, sidebarTarget } = useUIStore();

    if (isDesktop || !sidebarOpen) return null;

    return (
        <FloatingPanel open={sidebarOpen} onClose={closeSidebar}>
            <Tabs
                value={sidebarTab}
                onValueChange={(v) => setSidebarTab(v as SidebarTab)}
                className="flex h-full flex-col"
            >
                <TabsList className="w-full shrink-0 justify-start overflow-x-auto">
                    {TAB_CONFIG.map((tab) => (
                        <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
                            {tab.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
                <ScrollArea className="flex-1">
                    <TabsContent value="details" className="mt-0 p-3">
                        <DetailsTab target={sidebarTarget} />
                    </TabsContent>
                    <TabsContent value="edits" className="mt-0 p-3">
                        <EditsTab target={sidebarTarget} />
                    </TabsContent>
                    <TabsContent value="chat" className="mt-0 p-3">
                        <ChatTab target={sidebarTarget} />
                    </TabsContent>
                    <TabsContent value="actions" className="mt-0 p-3">
                        <ActionsTab target={sidebarTarget} />
                    </TabsContent>
                </ScrollArea>
            </Tabs>
        </FloatingPanel>
    );
}

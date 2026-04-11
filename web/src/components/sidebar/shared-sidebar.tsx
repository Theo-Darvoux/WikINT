"use client";

import { useUIStore, type SidebarTab } from "@/lib/stores";
import { useIsDesktop } from "@/hooks/use-media-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// --- Dynamic Tab Imports ---
// This ensures that heavy tab components (like Chat and Annotations) are only 
// compiled when they are actually opened, reducing memory pressure in dev.

const DetailsTab = dynamic(() => import("@/components/sidebar/details-tab").then(mod => mod.DetailsTab), {
  loading: () => <div className="p-4 space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></div>,
  ssr: false
});

const ChatTab = dynamic(() => import("@/components/sidebar/chat-tab").then(mod => mod.ChatTab), {
  loading: () => <div className="flex-1 flex items-center justify-center p-8"><Skeleton className="h-full w-full" /></div>,
  ssr: false
});

const ActionsTab = dynamic(() => import("@/components/sidebar/actions-tab").then(mod => mod.ActionsTab), {
  loading: () => <div className="p-4 space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-20 w-full" /></div>,
  ssr: false
});

const EditsTab = dynamic(() => import("@/components/sidebar/edits-tab").then(mod => mod.EditsTab), {
  loading: () => <div className="p-4 space-y-4"><Skeleton className="h-40 w-full" /></div>,
  ssr: false
});

const AnnotationsTab = dynamic(() => import("@/components/sidebar/annotations-tab").then(mod => mod.AnnotationsTab), {
  loading: () => <div className="flex-1 flex items-center justify-center p-8"><Skeleton className="h-full w-full" /></div>,
  ssr: false
});
import { X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";

const TAB_CONFIG: { value: SidebarTab; label: string }[] = [
  { value: "details", label: "Details" },
  { value: "chat", label: "Chat" },
  { value: "annotations", label: "Annots" },
  { value: "edits", label: "Edits" },
  { value: "actions", label: "Actions" },
];

function SidebarContent() {
  const { sidebarTab, setSidebarTab, sidebarTarget, closeSidebar } =
    useUIStore();
  const isDesktop = useIsDesktop();

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header - Only visible on desktop as Drawer handles its own header/dismissal needs */}
      {isDesktop && (
        <div className="flex items-center justify-between border-b px-3 py-2 shrink-0 bg-muted/10">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 flex items-center gap-2">
            <Info className="h-3 w-3" />
            Item Inspector
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 rounded-full hover:bg-destructive/10 hover:text-destructive"
            onClick={closeSidebar}
            title="Close sidebar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        value={sidebarTab}
        onValueChange={(v) => setSidebarTab(v as SidebarTab)}
        className="flex flex-1 min-h-0 flex-col gap-0"
      >
        <TabsList
          variant="line"
          className="w-full shrink-0 justify-start gap-0 border-b bg-transparent px-1 overflow-x-auto"
        >
          {TAB_CONFIG.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="px-2.5 py-2 text-xs shrink-0"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Key fix: relative+flex-1+min-h-0 container so absolute children get a real height */}
        <div className="relative flex-1 min-h-0">
          <TabsContent
            value="details"
            className="absolute inset-0 m-0 overflow-y-auto"
          >
            <div className="p-4">
              <DetailsTab target={sidebarTarget} />
            </div>
          </TabsContent>

          <TabsContent
            value="chat"
            className="absolute inset-0 m-0 flex flex-col"
          >
            <ChatTab target={sidebarTarget} />
          </TabsContent>

          <TabsContent
            value="annotations"
            className="absolute inset-0 m-0 flex flex-col"
          >
            <AnnotationsTab target={sidebarTarget} />
          </TabsContent>

          <TabsContent
            value="edits"
            className="absolute inset-0 m-0 overflow-y-auto"
          >
            <div className="p-4">
              <EditsTab target={sidebarTarget} />
            </div>
          </TabsContent>

          <TabsContent
            value="actions"
            className="absolute inset-0 m-0 flex flex-col"
          >
            <ActionsTab target={sidebarTarget} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

export function SharedSidebar() {
  const { sidebarOpen, closeSidebar } = useUIStore();
  const isDesktop = useIsDesktop();

  // Desktop: render directly inside the page's bounded container
  if (isDesktop) {
    if (!sidebarOpen) return null;
    return <SidebarContent />;
  }

  // Mobile: Drawer for native feel and swipe-to-dismiss
  return (
    <Drawer open={sidebarOpen} onOpenChange={(o) => !o && closeSidebar()}>
      <DrawerContent className="h-[90dvh] pb-0 outline-none">
        <DrawerTitle className="sr-only">Item Inspector</DrawerTitle>
        <div className="flex-1 overflow-hidden">
          <SidebarContent />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

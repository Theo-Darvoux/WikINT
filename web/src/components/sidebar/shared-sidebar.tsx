"use client";

import { Dialog as SheetPrimitive } from "radix-ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SheetPortal, SheetOverlay } from "@/components/ui/sheet";
import { useUIStore, type SidebarTab } from "@/lib/stores";
import { useIsDesktop } from "@/hooks/use-media-query";
import { DetailsTab } from "@/components/sidebar/details-tab";
import { ChatTab } from "@/components/sidebar/chat-tab";
import { ActionsTab } from "@/components/sidebar/actions-tab";
import { EditsTab } from "@/components/sidebar/edits-tab";
import { AnnotationsTab } from "@/components/sidebar/annotations-tab";
import { X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

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

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
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

  // Mobile: custom Sheet built from Radix Dialog primitives.
  // SidebarContent owns its own close button, so we skip SheetContent's
  // built-in close button by composing the primitives manually.
  return (
    <SheetPrimitive.Root
      open={sidebarOpen}
      onOpenChange={(open) => {
        if (!open) closeSidebar();
      }}
    >
      <SheetPortal>
        <SheetOverlay />
        <SheetPrimitive.Content
          className={[
            // Layout
            "fixed inset-y-0 right-0 z-50 h-full w-full sm:max-w-sm",
            // Visuals
            "border-l bg-background shadow-xl",
            // Animation
            "transition ease-in-out",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
            "data-[state=open]:duration-500 data-[state=closed]:duration-300",
          ].join(" ")}
        >
          {/* Visually hidden title for screen-reader accessibility */}
          <SheetPrimitive.Title className="sr-only">
            Item Inspector
          </SheetPrimitive.Title>

          <SidebarContent />
        </SheetPrimitive.Content>
      </SheetPortal>
    </SheetPrimitive.Root>
  );
}

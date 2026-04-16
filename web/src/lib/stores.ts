import { create } from "zustand";

export interface UserBrief {
    id: string;
    email: string;
    display_name: string | null;
    avatar_url: string | null;
    role: string;
    onboarded: boolean;
    auto_approve: boolean;
}

interface AuthState {
    user: UserBrief | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    setUser: (user: UserBrief | null) => void;
    setLoading: (loading: boolean) => void;
    logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    setUser: (user) => set({ user, isAuthenticated: !!user, isLoading: false }),
    setLoading: (isLoading) => set({ isLoading }),
    logout: () => set({ user: null, isAuthenticated: false, isLoading: false }),
}));

export type SidebarTab = "details" | "edits" | "chat" | "annotations";

interface SidebarTarget {
    type: "directory" | "material";
    id: string;
    data: Record<string, unknown>;
}

interface UIState {
    sidebarOpen: boolean;
    sidebarTab: SidebarTab;
    sidebarTarget: SidebarTarget | null;
    searchOpen: boolean;
    hideFooter: boolean;
    materialActionsOpen: boolean;
    openSidebar: (tab: SidebarTab, target: SidebarTarget) => void;
    setSidebarTarget: (tab: SidebarTab, target: SidebarTarget) => void;
    updateSidebarData: (data: Record<string, unknown>) => void;
    closeSidebar: () => void;
    setSidebarTab: (tab: SidebarTab) => void;
    setSidebarOpen: (open: boolean) => void;
    setSearchOpen: (open: boolean) => void;
    setMaterialActionsOpen: (open: boolean) => void;
    setHideFooter: (hide: boolean) => void;
    toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
    sidebarOpen: false,
    sidebarTab: "details",
    sidebarTarget: null,
    searchOpen: false,
    hideFooter: false,
    materialActionsOpen: false,
    openSidebar: (tab, target) =>
        set({ sidebarOpen: true, sidebarTab: tab, sidebarTarget: target }),
    setSidebarTarget: (tab, target) =>
        set({ sidebarTab: tab, sidebarTarget: target }),
    updateSidebarData: (data) =>
        set((state) => ({
            sidebarTarget: state.sidebarTarget
                ? { ...state.sidebarTarget, data: { ...state.sidebarTarget.data, ...data } }
                : null
        })),
    closeSidebar: () => set({ sidebarOpen: false }),
    setSidebarTab: (tab) => set({ sidebarTab: tab }),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    setSearchOpen: (open) => set({ searchOpen: open }),
    setMaterialActionsOpen: (open) => set({ materialActionsOpen: open }),
    setHideFooter: (hide) => set({ hideFooter: hide }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}));

// ---------------------------------------------------------------------------
// Browse refresh store — incremented after a direct-approved PR so the browse
// page re-fetches immediately without a manual page reload.
// ---------------------------------------------------------------------------
interface BrowseRefreshState {
    refreshCount: number;
    triggerBrowseRefresh: () => void;
}

export const useBrowseRefreshStore = create<BrowseRefreshState>((set) => ({
    refreshCount: 0,
    triggerBrowseRefresh: () =>
        set((state) => ({ refreshCount: state.refreshCount + 1 })),
}));

interface NotificationState {
    unreadCount: number;
    setUnreadCount: (count: number) => void;
    increment: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
    unreadCount: 0,
    setUnreadCount: (count) => set({ unreadCount: count }),
    increment: () => set((state) => ({ unreadCount: state.unreadCount + 1 })),
}));


import { create } from "zustand";

interface UserBrief {
    id: string;
    email: string;
    display_name: string | null;
    role: string;
    onboarded: boolean;
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

export type SidebarTab = "details" | "edits" | "chat" | "annotations" | "actions";

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
    openSidebar: (tab: SidebarTab, target: SidebarTarget) => void;
    closeSidebar: () => void;
    setSidebarTab: (tab: SidebarTab) => void;
    setSidebarOpen: (open: boolean) => void;
    setSearchOpen: (open: boolean) => void;
    toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
    sidebarOpen: false,
    sidebarTab: "details",
    sidebarTarget: null,
    searchOpen: false,
    openSidebar: (tab, target) =>
        set({ sidebarOpen: true, sidebarTab: tab, sidebarTarget: target }),
    closeSidebar: () => set({ sidebarOpen: false }),
    setSidebarTab: (tab) => set({ sidebarTab: tab }),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    setSearchOpen: (open) => set({ searchOpen: open }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
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


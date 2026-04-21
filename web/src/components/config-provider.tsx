"use client";

import { useEffect, ReactNode } from "react";
import { apiFetch } from "@/lib/api-client";
import { useConfigStore, PublicConfig } from "@/lib/stores";

export function ConfigProvider({ children }: { children: ReactNode }) {
    const { config, setConfig } = useConfigStore();

    // Initial fetch and BroadcastChannel setup
    useEffect(() => {
        const bc = new BroadcastChannel("wikint_config_updates");
        
        const fetchConfig = async () => {
            try {
                const data = await apiFetch<PublicConfig>("/auth/methods");
                setConfig(data);
            } catch (error) {
                console.error("Failed to fetch public config", error);
            }
        };

        bc.onmessage = (event) => {
            if (event.data === "refresh") {
                fetchConfig();
            }
        };

        fetchConfig();
        return () => bc.close();
    }, [setConfig]);

    // Apply config changes immediately to DOM/CSS whenever the store updates
    useEffect(() => {
        if (!config) return;

        // Update tab title and favicon dynamically
        if (config.site_name) {
            // Only update if it's the default title pattern
            if (document.title.includes("• WikINT")) {
                document.title = document.title.replace(/• WikINT$/, `• ${config.site_name}`);
            }
        }
        
        if (config.site_favicon_url) {
            let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
            if (!link) {
                link = document.createElement('link');
                link.rel = 'icon';
                document.getElementsByTagName('head')[0].appendChild(link);
            }
            link.href = config.site_favicon_url;
        }

        // Inject primary color if needed (custom CSS variable)
        if (config.primary_color) {
            document.documentElement.style.setProperty('--primary-custom', config.primary_color);
        }
    }, [config]);

    return <>{children}</>;
}

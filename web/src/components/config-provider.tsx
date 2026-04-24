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
            
            // Calculate and set a contrasting foreground color
            const hex = config.primary_color.replace('#', '');
            if (hex.length === 6) {
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                
                // If the background is light, use dark text; otherwise use light text
                const foreground = brightness > 165 ? 'oklch(0.205 0 0)' : 'oklch(0.985 0 0)';
                document.documentElement.style.setProperty('--primary-foreground-custom', foreground);
            } else {
                // Fallback to light text for custom colors if we can't parse it
                document.documentElement.style.setProperty('--primary-foreground-custom', 'oklch(0.985 0 0)');
            }
        }
    }, [config]);

    return <>{children}</>;
}

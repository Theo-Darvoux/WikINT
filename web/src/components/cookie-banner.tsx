"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function CookieBanner() {
    const [show, setShow] = useState(false);

    useEffect(() => {
        queueMicrotask(() => {
            const consent = localStorage.getItem("wikint_cookie_consent");
            if (!consent) {
                setShow(true);
            }
        });
    }, []);

    const accept = () => {
        localStorage.setItem("wikint_cookie_consent", "true");
        setShow(false);
    };

    if (!show) return null;

    return (
        <div className="fixed bottom-16 sm:bottom-4 right-4 z-[100] max-w-sm rounded-lg border bg-background p-4 shadow-lg animate-in slide-in-from-bottom-2">
            <h3 className="text-sm font-semibold mb-2">Cookie Consent</h3>
            <p className="text-xs text-muted-foreground mb-4">
                We use strictly necessary cookies to keep you logged in and functional items like preferred theme. We do not use third-party tracking cookies.
            </p>
            <div className="flex justify-end gap-2">
                <Button variant="default" size="sm" onClick={accept}>
                    Got it
                </Button>
            </div>
        </div>
    );
}

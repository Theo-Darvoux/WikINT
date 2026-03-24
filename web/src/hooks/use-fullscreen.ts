import { useState, useEffect, RefObject } from "react";

interface WebKitDocument extends Document {
    webkitFullscreenElement?: Element;
    webkitFullscreenEnabled?: boolean;
    webkitExitFullscreen?: () => void;
}

interface WebKitElement extends HTMLElement {
    webkitRequestFullscreen?: () => void;
    webkitEnterFullscreen?: () => void;
}

export function useFullscreen(ref: RefObject<HTMLElement | null>) {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [supportsFullscreen, setSupportsFullscreen] = useState(false);

    useEffect(() => {
        const handleFullscreenChange = () => {
            const doc = document as WebKitDocument;
            setIsFullscreen(!!doc.fullscreenElement || !!doc.webkitFullscreenElement);
        };

        const checkSupport = () => {
            const doc = document as WebKitDocument;
            const elem = ref.current as WebKitElement;
            setSupportsFullscreen(
                !!(
                    doc.fullscreenEnabled ||
                    doc.webkitFullscreenEnabled ||
                    elem?.webkitEnterFullscreen
                )
            );
        };

        checkSupport();
        document.addEventListener("fullscreenchange", handleFullscreenChange);
        document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
        return () => {
            document.removeEventListener("fullscreenchange", handleFullscreenChange);
            document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
        };
    }, [ref]);

    const toggleFullscreen = () => {
        if (!ref.current) return;
        const elem = ref.current as WebKitElement;
        const doc = document as WebKitDocument;

        if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
            if (elem.requestFullscreen) {
                elem.requestFullscreen().catch((err: Error) => {
                    console.error(`Error attempting to enable full-screen mode: ${err.message}`);
                });
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
            } else if (elem.webkitEnterFullscreen) {
                elem.webkitEnterFullscreen();
            }
        } else {
            if (doc.exitFullscreen) {
                doc.exitFullscreen();
            } else if (doc.webkitExitFullscreen) {
                doc.webkitExitFullscreen();
            }
        }
    };

    return { isFullscreen, toggleFullscreen, supportsFullscreen };
}

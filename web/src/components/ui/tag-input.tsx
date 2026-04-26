"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface TagInputProps {
    tags: string[];
    onChange: (tags: string[]) => void;
    placeholder?: string;
    maxLength?: number;
    maxTags?: number;
    className?: string;
}

export function TagInput({
    tags,
    onChange,
    placeholder,
    maxLength = 20,
    maxTags = 20,
    className,
}: TagInputProps) {
    const t = useTranslations("Common");
    const [inputValue, setInputValue] = React.useState("");
    const inputRef = React.useRef<HTMLInputElement>(null);
    const displayPlaceholder = placeholder || t("addTagPlaceholder");

    const isLimitReached = tags.length >= maxTags;

    const addTag = (tag: string) => {
        if (isLimitReached) return;
        
        const trimmedTag = tag.trim().toLowerCase();
        if (trimmedTag && trimmedTag.length <= maxLength && !tags.includes(trimmedTag)) {
            onChange([...tags, trimmedTag]);
        }
        setInputValue("");
    };

    const removeTag = (indexToRemove: number) => {
        onChange(tags.filter((_, index) => index !== indexToRemove));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || e.key === "," || e.key === " ") {
            e.preventDefault();
            addTag(inputValue);
        } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
            e.preventDefault();
            removeTag(tags.length - 1);
        }
    };

    return (
        <div className="space-y-1.5 w-full">
            <div
                className={cn(
                    "flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                    isLimitReached && "opacity-80 ring-muted",
                    className
                )}
                onClick={() => inputRef.current?.focus()}
            >
                {tags.map((tag, index) => (
                    <Badge
                        key={`${tag}-${index}`}
                        variant="secondary"
                        className="flex items-center gap-1 pl-2 pr-1 h-7 text-xs font-medium bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/50"
                    >
                        {tag}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                removeTag(index);
                            }}
                            className="rounded-full outline-none hover:bg-blue-200/50 dark:hover:bg-blue-800/50 p-0.5 transition-colors"
                        >
                            <X className="h-3 w-3" />
                            <span className="sr-only">{t("removeTag", { tag })}</span>
                        </button>
                    </Badge>
                ))}
                {!isLimitReached && (
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={tags.length === 0 ? displayPlaceholder : ""}
                        className="flex-1 min-w-[100px] bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                        maxLength={maxLength}
                    />
                )}
            </div>
            
            <div className="flex items-center justify-between px-1">
                <span className={cn(
                    "text-[10px] font-medium transition-colors",
                    isLimitReached ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                )}>
                    {isLimitReached 
                        ? t("maxTagsReached", { max: maxTags })
                        : t("tagsCount", { current: tags.length, max: maxTags })}
                </span>
                {inputValue.length > 0 && (
                    <span className={cn(
                        "text-[10px] font-medium transition-colors",
                        inputValue.length >= maxLength ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                    )}>
                        {t("charsCount", { current: inputValue.length, max: maxLength })}
                    </span>
                )}
            </div>
        </div>
    );
}

"use client";

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function MentionTextarea({
  value,
  onChange,
  placeholder,
  className,
  disabled,
}: MentionTextareaProps) {
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder || "Add a note..."}
      className={cn("min-h-[100px]", className)}
      disabled={disabled}
    />
  );
}

/**
 * Render notes content with @mentions highlighted
 */
export function renderNotesWithMentions(content: string): React.ReactNode {
  if (!content) return null;

  // Simple regex to find @mentions
  const mentionRegex = /@(\w+)/g;
  const parts = content.split(mentionRegex);

  return parts.map((part, index) => {
    // Every odd index is a mention (captured group)
    if (index % 2 === 1) {
      return (
        <span key={index} className="bg-blue-100 text-blue-800 px-1 rounded">
          @{part}
        </span>
      );
    }
    return part;
  });
}

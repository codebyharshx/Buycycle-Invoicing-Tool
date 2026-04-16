"use client";

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import axios from "axios";
import { getToken } from "@/lib/auth";

interface User {
  id: number;
  name: string | null;
  email: string;
}

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const api = axios.create({ baseURL: "/api" });
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function MentionTextarea({
  value,
  onChange,
  placeholder,
  className,
  disabled,
}: MentionTextareaProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const [showDropdown, setShowDropdown] = React.useState(false);
  const [users, setUsers] = React.useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = React.useState<User[]>([]);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [mentionStart, setMentionStart] = React.useState<number | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [dropdownPosition, setDropdownPosition] = React.useState({ top: 0, left: 0 });

  // Fetch users on mount
  React.useEffect(() => {
    async function fetchUsers() {
      try {
        const response = await api.get("/threads/users");
        if (response.data.success) {
          setUsers(response.data.users);
        }
      } catch (error) {
        console.error("Failed to fetch users for mentions:", error);
      }
    }
    fetchUsers();
  }, []);

  // Filter users based on search query
  React.useEffect(() => {
    if (!searchQuery) {
      setFilteredUsers(users.slice(0, 5));
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = users.filter(
        (user) =>
          user.name?.toLowerCase().includes(query) ||
          user.email.toLowerCase().includes(query)
      ).slice(0, 5);
      setFilteredUsers(filtered);
    }
    setSelectedIndex(0);
  }, [searchQuery, users]);

  // Calculate dropdown position
  const updateDropdownPosition = React.useCallback(() => {
    if (!textareaRef.current || mentionStart === null) return;

    const textarea = textareaRef.current;
    const textBeforeCursor = value.substring(0, mentionStart);

    // Create a hidden div to measure text position
    const mirror = document.createElement("div");
    const style = window.getComputedStyle(textarea);

    mirror.style.cssText = `
      position: absolute;
      visibility: hidden;
      white-space: pre-wrap;
      word-wrap: break-word;
      width: ${textarea.clientWidth}px;
      font-family: ${style.fontFamily};
      font-size: ${style.fontSize};
      line-height: ${style.lineHeight};
      padding: ${style.padding};
    `;
    mirror.textContent = textBeforeCursor;

    const span = document.createElement("span");
    span.textContent = "@";
    mirror.appendChild(span);

    document.body.appendChild(mirror);
    const spanRect = span.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();
    document.body.removeChild(mirror);

    setDropdownPosition({
      top: Math.min(spanRect.top - textareaRect.top + 24, textarea.clientHeight - 10),
      left: Math.min(spanRect.left - textareaRect.left, textarea.clientWidth - 200),
    });
  }, [value, mentionStart]);

  React.useEffect(() => {
    if (showDropdown) {
      updateDropdownPosition();
    }
  }, [showDropdown, updateDropdownPosition]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;

    onChange(newValue);

    // Check if we should show/hide the dropdown
    const textBeforeCursor = newValue.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      // Only show dropdown if @ is at start or after whitespace, and no space after @
      const charBeforeAt = lastAtIndex > 0 ? newValue[lastAtIndex - 1] : " ";
      const isValidMention = /\s/.test(charBeforeAt) || lastAtIndex === 0;
      const hasNoSpace = !/\s/.test(textAfterAt);

      if (isValidMention && hasNoSpace) {
        setMentionStart(lastAtIndex);
        setSearchQuery(textAfterAt);
        setShowDropdown(true);
        return;
      }
    }

    setShowDropdown(false);
    setMentionStart(null);
    setSearchQuery("");
  };

  const insertMention = (user: User) => {
    if (mentionStart === null) return;

    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart || value.length;

    const beforeMention = value.substring(0, mentionStart);
    const afterMention = value.substring(cursorPos);

    // Insert @[userId] format for backend parsing, display name for readability
    const displayName = user.name || user.email.split("@")[0];
    const mentionText = `@${displayName} `;

    const newValue = beforeMention + mentionText + afterMention;
    onChange(newValue);

    // Reset state
    setShowDropdown(false);
    setMentionStart(null);
    setSearchQuery("");

    // Focus and set cursor position after the mention
    setTimeout(() => {
      if (textarea) {
        const newCursorPos = beforeMention.length + mentionText.length;
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showDropdown || filteredUsers.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredUsers.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredUsers.length) % filteredUsers.length);
        break;
      case "Enter":
      case "Tab":
        e.preventDefault();
        insertMention(filteredUsers[selectedIndex]);
        break;
      case "Escape":
        setShowDropdown(false);
        break;
    }
  };

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || "Add a note... Type @ to mention someone"}
        className={cn("min-h-[100px]", className)}
        disabled={disabled}
      />

      {/* Mentions Dropdown */}
      {showDropdown && filteredUsers.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-56"
          style={{
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
          }}
        >
          <div className="px-2 py-1 text-xs text-gray-500 border-b">
            Select a user
          </div>
          {filteredUsers.map((user, index) => (
            <button
              key={user.id}
              type="button"
              onClick={() => insertMention(user)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center gap-2",
                index === selectedIndex && "bg-blue-50"
              )}
            >
              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                {(user.name || user.email)[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {user.name || user.email.split("@")[0]}
                </div>
                <div className="text-xs text-gray-500 truncate">{user.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {showDropdown && filteredUsers.length === 0 && searchQuery && (
        <div
          ref={dropdownRef}
          className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-3 px-4 w-56 text-sm text-gray-500"
          style={{
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
          }}
        >
          No users found
        </div>
      )}
    </div>
  );
}

/**
 * Render notes content with @mentions highlighted
 */
export function renderNotesWithMentions(content: string): React.ReactNode {
  if (!content) return null;

  // Match @mentions (word characters after @)
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const mentionRegex = /@(\w+)/g;
  let match;

  while ((match = mentionRegex.exec(content)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(content.substring(lastIndex, match.index));
    }

    // Add the highlighted mention
    parts.push(
      <span
        key={match.index}
        className="bg-blue-100 text-blue-700 px-1 py-0.5 rounded text-sm font-medium"
      >
        @{match[1]}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push(content.substring(lastIndex));
  }

  return parts.length > 0 ? parts : content;
}

"use client";

import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DateRangeValue {
  start: Date | null;
  end: Date | null;
}

interface DateRangeCalendarProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
}

export function DateRangeCalendar({ value, onChange, className }: DateRangeCalendarProps) {
  const [open, setOpen] = React.useState(false);

  const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value ? new Date(e.target.value) : null;
    onChange({ ...value, start: date });
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value ? new Date(e.target.value) : null;
    onChange({ ...value, end: date });
  };

  const formatDateForInput = (date: Date | null) => {
    if (!date) return "";
    return format(date, "yyyy-MM-dd");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !value.start && !value.end && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value.start || value.end ? (
            <>
              {value.start ? format(value.start, "MMM d, yyyy") : "Start"} -{" "}
              {value.end ? format(value.end, "MMM d, yyyy") : "End"}
            </>
          ) : (
            <span>Pick a date range</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-4" align="start">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Start Date</label>
            <input
              type="date"
              value={formatDateForInput(value.start)}
              onChange={handleStartChange}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">End Date</label>
            <input
              type="date"
              value={formatDateForInput(value.end)}
              onChange={handleEndChange}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onChange({ start: null, end: null });
              }}
            >
              Clear
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Single Date Picker with calendar popover
 * Accepts and returns dates in DD/MM/YYYY format
 */
interface SingleDatePickerProps {
  value?: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function SingleDatePicker({
  value,
  onChange,
  placeholder = "DD/MM/YYYY",
  className,
  disabled,
}: SingleDatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState(value || "");

  // Sync input value with prop changes
  React.useEffect(() => {
    setInputValue(value || "");
  }, [value]);

  // Parse DD/MM/YYYY to Date object
  const parseDisplayDate = (str: string): Date | null => {
    if (!str) return null;
    // Try DD/MM/YYYY format
    const ddmmyyyy = parse(str, "dd/MM/yyyy", new Date());
    if (isValid(ddmmyyyy)) return ddmmyyyy;
    // Try YYYY-MM-DD format (ISO)
    const iso = parse(str, "yyyy-MM-dd", new Date());
    if (isValid(iso)) return iso;
    return null;
  };

  // Format Date to DD/MM/YYYY for display
  const formatDisplayDate = (date: Date): string => {
    return format(date, "dd/MM/yyyy");
  };

  // Format Date to YYYY-MM-DD for native input
  const formatInputDate = (date: Date | null): string => {
    if (!date) return "";
    return format(date, "yyyy-MM-dd");
  };

  const parsedDate = parseDisplayDate(inputValue);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputBlur = () => {
    const parsed = parseDisplayDate(inputValue);
    if (parsed) {
      const formatted = formatDisplayDate(parsed);
      setInputValue(formatted);
      onChange(formatted);
    } else if (!inputValue) {
      onChange(null);
    }
  };

  const handleCalendarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dateStr = e.target.value;
    if (dateStr) {
      const date = new Date(dateStr);
      const formatted = formatDisplayDate(date);
      setInputValue(formatted);
      onChange(formatted);
    } else {
      setInputValue("");
      onChange(null);
    }
    setOpen(false);
  };

  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <div className="relative">
          <Input
            type="text"
            placeholder={placeholder}
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            disabled={disabled}
            className="h-9 text-sm pr-9"
          />
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-9 w-9 p-0 hover:bg-transparent"
              disabled={disabled}
            >
              <CalendarIcon className="h-4 w-4 text-gray-400" />
            </Button>
          </PopoverTrigger>
        </div>
        <PopoverContent className="w-auto p-3" align="end">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-gray-500">Select date</label>
            <input
              type="date"
              value={formatInputDate(parsedDate)}
              onChange={handleCalendarChange}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {parsedDate && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-gray-500"
                onClick={() => {
                  setInputValue("");
                  onChange(null);
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

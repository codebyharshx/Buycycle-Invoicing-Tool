'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DateRangeCalendar, type DateRangeValue } from '@/components/ui/date-picker';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronDown, Calendar, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { invoicesApi, agentsApi, type Agent } from '@/lib/api';
import type { InvoiceExtractionStatus } from '@shared/types';

// Filter state types
export interface InvoiceFilters {
  status: InvoiceExtractionStatus | 'all';
  vendors: string[];
  invoiceTypes: ('standard' | 'line_items')[];
  assignees: number[];
  issueDateRange: { start: string | null; end: string | null; preset: 'custom' | '7days' | '14days' | null };
  dueDateRange: { start: string | null; end: string | null; preset: 'custom' | '7days' | '14days' | null };
}

export const defaultFilters: InvoiceFilters = {
  status: 'all',
  vendors: [],
  invoiceTypes: [],
  assignees: [],
  issueDateRange: { start: null, end: null, preset: null },
  dueDateRange: { start: null, end: null, preset: null },
};

interface InvoiceFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: InvoiceFilters;
  onApplyFilters: (filters: InvoiceFilters) => void;
}

// Status options
const STATUS_OPTIONS: { value: InvoiceExtractionStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending Approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'rejected', label: 'Deleted' },
];

// Invoice type options
const INVOICE_TYPE_OPTIONS = [
  { value: 'standard', label: 'Standard Invoice' },
  { value: 'line_items', label: 'Line Items Invoice' },
];

// Multi-select dropdown component
function MultiSelectDropdown({
  label,
  placeholder,
  options,
  selected,
  onSelectionChange,
  icon,
}: {
  label: string;
  placeholder: string;
  options: { value: string; label: string }[];
  selected: string[];
  onSelectionChange: (values: string[]) => void;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback(
    (value: string) => {
      if (selected.includes(value)) {
        onSelectionChange(selected.filter((v) => v !== value));
      } else {
        onSelectionChange([...selected, value]);
      }
    },
    [selected, onSelectionChange]
  );

  const displayText = useMemo(() => {
    if (selected.length === 0) return placeholder;
    if (selected.length === 1) {
      return options.find((o) => o.value === selected[0])?.label || selected[0];
    }
    return `${selected.length} selected`;
  }, [selected, options, placeholder]);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal text-left h-10"
          >
            <span className="flex items-center gap-2 truncate">
              {icon}
              <span className={cn(selected.length === 0 && 'text-muted-foreground')}>{displayText}</span>
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem key={option.value} value={option.value} onSelect={() => handleSelect(option.value)}>
                    <Check
                      className={cn('mr-2 h-4 w-4', selected.includes(option.value) ? 'opacity-100' : 'opacity-0')}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Date range picker component
function DateRangePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { start: string | null; end: string | null; preset: 'custom' | '7days' | '14days' | null };
  onChange: (value: { start: string | null; end: string | null; preset: 'custom' | '7days' | '14days' | null }) => void;
}) {
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const parseDateValue = (dateValue: string | null): Date | null => {
    if (!dateValue) return null;
    const parsed = parseISO(dateValue);
    return isValid(parsed) ? parsed : null;
  };

  const formatDateLabel = (dateValue: string | null): string => {
    if (!dateValue) return '';
    const parsed = parseDateValue(dateValue);
    return parsed ? format(parsed, 'MMM d, yyyy') : dateValue;
  };

  const startDate = parseDateValue(value.start);
  const endDate = parseDateValue(value.end);

  const handlePreset = (preset: '7days' | '14days') => {
    const end = new Date();
    const start = new Date();
    if (preset === '7days') {
      start.setDate(start.getDate() - 7);
    } else {
      start.setDate(start.getDate() - 14);
    }
    onChange({
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
      preset,
    });
  };

  const handleRangeChange = (range: DateRangeValue) => {
    onChange({
      ...value,
      start: range.start ? format(range.start, 'yyyy-MM-dd') : null,
      end: range.end ? format(range.end, 'yyyy-MM-dd') : null,
      preset: 'custom',
    });
  };

  const clearDates = () => {
    onChange({ start: null, end: null, preset: null });
  };

  const formatDateDisplay = (): string => {
    if (!value.start && !value.end) return 'Select date range';
    if (value.start && value.end) {
      return `${formatDateLabel(value.start)} - ${formatDateLabel(value.end)}`;
    }
    return formatDateLabel(value.start || value.end) || 'Select date range';
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={value.preset === '7days' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handlePreset('7days')}
          className="h-9"
        >
          7 days
        </Button>
        <Button
          type="button"
          variant={value.preset === '14days' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handlePreset('14days')}
          className="h-9"
        >
          14 days
        </Button>
        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant={value.preset === 'custom' ? 'default' : 'outline'}
              size="sm"
              className="h-9 flex items-center gap-2"
            >
              <Calendar className="h-4 w-4" />
              {value.preset === 'custom' ? formatDateDisplay() : 'Select date range'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[360px] p-3" align="start">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <div className="text-[10px] font-medium uppercase text-slate-500">Start</div>
                  <div className="text-xs font-semibold text-slate-900">
                    {formatDateLabel(value.start) || 'Select date'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <div className="text-[10px] font-medium uppercase text-slate-500">End</div>
                  <div className="text-xs font-semibold text-slate-900">
                    {formatDateLabel(value.end) || 'Select date'}
                  </div>
                </div>
              </div>
              <DateRangeCalendar
                value={{ start: startDate, end: endDate }}
                onChange={handleRangeChange}
              />
              <div className="flex justify-between">
                <Button type="button" variant="ghost" size="sm" onClick={clearDates}>
                  Clear
                </Button>
                <Button type="button" size="sm" onClick={() => setDatePickerOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        {(value.start || value.end) && (
          <Button type="button" variant="ghost" size="sm" onClick={clearDates} className="h-9 px-2">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function InvoiceFilterDialog({
  open,
  onOpenChange,
  filters,
  onApplyFilters,
}: InvoiceFilterDialogProps) {
  // Local state for filters (to allow cancel without applying)
  const [localFilters, setLocalFilters] = useState<InvoiceFilters>(filters);

  // Reset local filters when dialog opens
  useEffect(() => {
    if (open) {
      setLocalFilters(filters);
    }
  }, [open, filters]);

  // Fetch vendors
  const { data: vendorsData } = useQuery({
    queryKey: ['invoice-vendors'],
    queryFn: () => invoicesApi.vendors(),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch agents
  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () => agentsApi.list(),
    staleTime: 5 * 60 * 1000,
  });

  // Convert agents to options
  const agentOptions = useMemo(() => {
    return (
      agentsData?.data.map((agent: Agent) => ({
        value: agent.id.toString(),
        label: `${agent.firstName} ${agent.lastName}`,
      })) || []
    );
  }, [agentsData]);

  // Convert vendors to options
  const vendorOptions = useMemo(() => {
    return (vendorsData?.vendors || []).map((vendor) => ({
      value: vendor,
      label: vendor,
    }));
  }, [vendorsData]);

  const handleReset = () => {
    setLocalFilters(defaultFilters);
  };

  const handleApply = () => {
    onApplyFilters(localFilters);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setLocalFilters(filters); // Reset to original
    onOpenChange(false);
  };

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      localFilters.status !== 'all' ||
      localFilters.vendors.length > 0 ||
      localFilters.invoiceTypes.length > 0 ||
      localFilters.assignees.length > 0 ||
      localFilters.issueDateRange.start !== null ||
      localFilters.issueDateRange.end !== null ||
      localFilters.dueDateRange.start !== null ||
      localFilters.dueDateRange.end !== null
    );
  }, [localFilters]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Filter Invoices</DialogTitle>
          <DialogDescription>Use the filters below to find specific invoices</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Status */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Status</label>
            <Select
              value={localFilters.status}
              onValueChange={(value) =>
                setLocalFilters((prev) => ({ ...prev, status: value as InvoiceExtractionStatus | 'all' }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Vendors and Invoice Types - side by side */}
          <div className="grid grid-cols-2 gap-4">
            <MultiSelectDropdown
              label="Vendors"
              placeholder="Select vendors"
              options={vendorOptions}
              selected={localFilters.vendors}
              onSelectionChange={(values) => setLocalFilters((prev) => ({ ...prev, vendors: values }))}
            />
            <MultiSelectDropdown
              label="Invoice Types"
              placeholder="Select invoice types"
              options={INVOICE_TYPE_OPTIONS}
              selected={localFilters.invoiceTypes}
              onSelectionChange={(values) =>
                setLocalFilters((prev) => ({ ...prev, invoiceTypes: values as ('standard' | 'line_items')[] }))
              }
            />
          </div>

          {/* Assigned to */}
          <MultiSelectDropdown
            label="Assigned to"
            placeholder="Select assignees"
            options={agentOptions}
            selected={localFilters.assignees.map(String)}
            onSelectionChange={(values) =>
              setLocalFilters((prev) => ({ ...prev, assignees: values.map((v) => parseInt(v, 10)) }))
            }
            icon={<User className="h-4 w-4 text-gray-400" />}
          />

          {/* Invoice Issue Date */}
          <DateRangePicker
            label="Invoice Issue Date"
            value={localFilters.issueDateRange}
            onChange={(value) => setLocalFilters((prev) => ({ ...prev, issueDateRange: value }))}
          />

          {/* Invoice Due Date */}
          <DateRangePicker
            label="Invoice Due Date"
            value={localFilters.dueDateRange}
            onChange={(value) => setLocalFilters((prev) => ({ ...prev, dueDateRange: value }))}
          />
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button
            type="button"
            variant="link"
            className="text-blue-600 px-0 hover:text-blue-800"
            onClick={handleReset}
            disabled={!hasActiveFilters}
          >
            Reset all filters
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="button" onClick={handleApply}>
              Apply Filters
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

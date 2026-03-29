'use client';

/**
 * Invoice Export Dialog Component
 * Dialog for selecting fields to export to CSV
 */

import { useState, useMemo } from 'react';
import type { InvoiceExtractionRecord } from '@shared/types';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Download, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { threadsApi } from '@/lib/api';
import {
  getAvailableFieldsForInvoices,
  getDefaultSelectedFields,
  generateCsv,
  downloadCsv,
  type ExportField,
} from '@/lib/invoice-export';

interface InvoiceExportDialogProps {
  invoices: InvoiceExtractionRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InvoiceExportDialog({ invoices, open, onOpenChange }: InvoiceExportDialogProps) {
  // Get available fields based on invoices (only approved fields)
  const availableFields = useMemo(
    () => getAvailableFieldsForInvoices(),
    []
  );

  // Initialize with default selected fields (all available green fields)
  const [selectedFields, setSelectedFields] = useState<string[]>(() =>
    getDefaultSelectedFields()
  );

  // Count how many invoices have each field approved
  const fieldAvailability = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const field of availableFields) {
      counts[field.key] = invoices.filter((inv) => field.isApproved(inv)).length;
    }
    return counts;
  }, [availableFields, invoices]);

  // Group fields by category
  const fieldsByCategory = useMemo(() => {
    const grouped: Record<string, ExportField[]> = {
      core: [],
      dates: [],
      amounts: [],
      metadata: [],
      system: [],
    };

    for (const field of availableFields) {
      grouped[field.category].push(field);
    }

    return grouped;
  }, [availableFields]);

  const categoryLabels: Record<string, string> = {
    core: 'Core Invoice Information',
    dates: 'Dates',
    amounts: 'Financial Details',
    metadata: 'Additional Information',
    system: 'System Information',
  };

  const handleToggleField = (fieldKey: string) => {
    setSelectedFields((prev) =>
      prev.includes(fieldKey)
        ? prev.filter((k) => k !== fieldKey)
        : [...prev, fieldKey]
    );
  };

  const handleSelectAll = () => {
    setSelectedFields(availableFields.map((f) => f.key));
  };

  const handleSelectNone = () => {
    setSelectedFields([]);
  };

  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (selectedFields.length === 0) {
      toast.error('Please select at least one field to export');
      return;
    }

    setIsExporting(true);
    try {
      // Fetch notes from threads if the notes field is selected
      let notesMap: Map<number, string> | undefined;
      if (selectedFields.includes('notes')) {
        notesMap = new Map();
        const results = await Promise.all(
          invoices.map(async (inv) => {
            const response = await threadsApi.list({
              entity_type: 'invoice',
              entity_id: String(inv.id),
              sort: 'oldest',
              limit: 100,
            });
            return { id: inv.id, threads: response.threads };
          })
        );
        for (const { id, threads } of results) {
          const nonDeleted = threads.filter((t) => !t.is_deleted);
          if (nonDeleted.length > 0) {
            const concatenated = nonDeleted
              .map((t) => `${t.author_name} (${new Date(t.created_at).toLocaleDateString('en-GB')}): ${t.content}`)
              .join(' | ');
            notesMap.set(id, concatenated);
          }
        }
      }

      // Generate CSV
      const csvContent = generateCsv(invoices, selectedFields, notesMap);

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().split('T')[0];
      const fileName = `invoices_export_${timestamp}.csv`;

      // Download file
      downloadCsv(csvContent, fileName);

      // Close dialog
      onOpenChange(false);
    } catch {
      toast.error('Failed to export invoices');
    } finally {
      setIsExporting(false);
    }
  };

  const Availability = ({ count, total }: { count: number; total: number }) => (
    <span className="inline-flex items-center ml-2 text-[11px] text-green-600">
      <CheckCircle2 className="h-3 w-3 mr-1" />
      {count}/{total} approved
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg w-[560px] p-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 pr-12 pt-5 pb-3 border-b">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                <Download className="h-4 w-4" />
                Export Invoices to CSV
              </DialogTitle>
              <p className="text-xs text-gray-600 mt-1">
                Approved invoices export all fields. Pending invoices only export green (3/3 consensus) fields. All available fields pre-selected. Exporting {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleSelectAll}>Select All</Button>
              <Button variant="outline" size="sm" onClick={handleSelectNone}>Clear All</Button>
            </div>
          </div>
          <div className="text-xs text-gray-600 mt-3">{selectedFields.length} field{selectedFields.length !== 1 ? 's' : ''} selected</div>
        </div>

        {/* Body */}
        <div className="px-5 py-3 space-y-4 max-h-[60vh] overflow-y-auto">
          {Object.entries(fieldsByCategory).map(([category, fields]) => {
            if (fields.length === 0) return null;
            return (
              <div key={category} className="space-y-2">
                <h3 className="text-[13px] font-semibold text-gray-800">{categoryLabels[category]}</h3>
                <div className="space-y-1">
                  {fields.map((field) => {
                    const isSelected = selectedFields.includes(field.key);
                    const availableCount = fieldAvailability[field.key] || 0;
                    const isSystemField = field.category === 'system';
                    return (
                      <div key={field.key} className="flex items-start gap-3 py-1.5">
                        <Checkbox
                          id={field.key}
                          checked={isSelected}
                          onCheckedChange={() => handleToggleField(field.key)}
                          className="mt-0.5 data-[state=checked]:bg-black data-[state=checked]:border-black"
                        />
                        <div className="flex-1 min-w-0">
                          <Label htmlFor={field.key} className="text-sm font-medium cursor-pointer flex items-center">
                            {field.label}
                            {!isSystemField && <Availability count={availableCount} total={invoices.length} />}
                          </Label>
                          <p className="text-xs text-gray-500 mt-0.5">{field.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>Cancel</Button>
          <Button onClick={handleExport} disabled={selectedFields.length === 0 || isExporting}>
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {isExporting ? 'Exporting...' : 'Export CSV'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

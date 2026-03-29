'use client';

/**
 * Data Source Modal Component
 * Dialog for creating and editing invoice data sources
 */

import { useState, useEffect } from 'react';
import type {
  InvoiceDataSource,
  CreateInvoiceDataSourceRequest,
  UpdateInvoiceDataSourceRequest,
  InvoiceDataSourceStatus,
} from '@shared/types';
import { INVOICE_DATA_SOURCE_STATUS_LABELS } from '@shared/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Mail, Info } from 'lucide-react';

interface DataSourceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataSource?: InvoiceDataSource | null;
  onSave: (data: CreateInvoiceDataSourceRequest | UpdateInvoiceDataSourceRequest) => Promise<void>;
  emailDomain?: string;
}

const STATUS_OPTIONS: InvoiceDataSourceStatus[] = ['active', 'paused'];

export function DataSourceModal({
  open,
  onOpenChange,
  dataSource,
  onSave,
  emailDomain = 'invoices.buycycle.com',
}: DataSourceModalProps) {
  const isEditMode = !!dataSource;

  // Form state
  const [name, setName] = useState('');
  const [emailPrefix, setEmailPrefix] = useState('');
  const [status, setStatus] = useState<InvoiceDataSourceStatus>('active');
  const [vendorHint, setVendorHint] = useState('');
  const [autoProcess, setAutoProcess] = useState(true);
  const [description, setDescription] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compute full email address
  const fullEmailAddress = emailPrefix ? `${emailPrefix.toLowerCase()}@${emailDomain}` : '';

  // Populate form when editing
  useEffect(() => {
    if (dataSource) {
      setName(dataSource.name);
      // Extract prefix from email address
      const prefix = dataSource.email_address.split('@')[0] || '';
      setEmailPrefix(prefix);
      setStatus(dataSource.status);
      setVendorHint(dataSource.vendor_hint || '');
      setAutoProcess(dataSource.auto_process);
      setDescription(dataSource.description || '');
    } else {
      // Reset form for new data source
      setName('');
      setEmailPrefix('');
      setStatus('active');
      setVendorHint('');
      setAutoProcess(true);
      setDescription('');
    }
    setError(null);
  }, [dataSource, open]);

  const handleSubmit = async () => {
    // Validation
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    if (!isEditMode && !emailPrefix.trim()) {
      setError('Email prefix is required');
      return;
    }

    // Validate email prefix format
    if (!isEditMode && !/^[a-zA-Z0-9._-]+$/.test(emailPrefix)) {
      setError('Email prefix can only contain letters, numbers, dots, dashes, and underscores');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (isEditMode) {
        // Update mode - can't change email address
        const data: UpdateInvoiceDataSourceRequest = {
          name: name.trim(),
          status,
          vendor_hint: vendorHint.trim() || null,
          auto_process: autoProcess,
          description: description.trim() || null,
        };
        await onSave(data);
      } else {
        // Create mode
        const data: CreateInvoiceDataSourceRequest = {
          name: name.trim(),
          email_address: fullEmailAddress,
          vendor_hint: vendorHint.trim() || undefined,
          auto_process: autoProcess,
          description: description.trim() || undefined,
        };
        await onSave(data);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save data source');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Edit Data Source' : 'Create Email Data Source'}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update the data source settings.'
              : 'Create an email address where carriers can send invoices for automatic processing.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Name */}
          <div className="grid gap-2">
            <Label htmlFor="name">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., UPS Invoices"
            />
          </div>

          {/* Email Address */}
          <div className="grid gap-2">
            <Label htmlFor="emailPrefix">
              Email Address <span className="text-red-500">*</span>
            </Label>
            {isEditMode ? (
              <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-md">
                <Mail className="h-4 w-4 text-gray-400" />
                <code className="text-sm">{dataSource?.email_address}</code>
                <span className="text-xs text-gray-500 ml-auto">(cannot be changed)</span>
              </div>
            ) : (
              <div className="flex items-center gap-0">
                <Input
                  id="emailPrefix"
                  value={emailPrefix}
                  onChange={(e) => setEmailPrefix(e.target.value.toLowerCase())}
                  placeholder="ups"
                  className="rounded-r-none"
                />
                <div className="flex items-center px-3 h-9 bg-gray-100 border border-l-0 border-gray-200 rounded-r-md text-sm text-gray-600">
                  @{emailDomain}
                </div>
              </div>
            )}
            {fullEmailAddress && !isEditMode && (
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <Info className="h-3 w-3" />
                Invoices sent to <code className="bg-gray-100 px-1 rounded">{fullEmailAddress}</code> will be processed automatically
              </div>
            )}
          </div>

          {/* Status (only in edit mode) */}
          {isEditMode && (
            <div className="grid gap-2">
              <Label>Status</Label>
              <div className="flex gap-3">
                {STATUS_OPTIONS.map((opt) => (
                  <div key={opt} className="flex items-center gap-2">
                    <input
                      type="radio"
                      id={`status-${opt}`}
                      name="status"
                      checked={status === opt}
                      onChange={() => setStatus(opt)}
                      className="h-4 w-4"
                    />
                    <Label
                      htmlFor={`status-${opt}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {INVOICE_DATA_SOURCE_STATUS_LABELS[opt]}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vendor Hint */}
          <div className="grid gap-2">
            <Label htmlFor="vendorHint">Vendor Hint</Label>
            <Input
              id="vendorHint"
              value={vendorHint}
              onChange={(e) => setVendorHint(e.target.value)}
              placeholder="e.g., UPS, DHL, FedEx"
            />
            <p className="text-xs text-gray-500">
              Helps the OCR system identify the vendor format
            </p>
          </div>

          {/* Auto Process */}
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <Checkbox
              id="autoProcess"
              checked={autoProcess}
              onCheckedChange={(checked) => setAutoProcess(checked === true)}
            />
            <div className="space-y-0.5">
              <Label htmlFor="autoProcess" className="cursor-pointer">Auto-Process Attachments</Label>
              <p className="text-xs text-gray-500">
                Automatically run OCR on PDF attachments when received
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="grid gap-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional notes about this data source"
              rows={2}
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="text-sm text-red-500 bg-red-50 p-2 rounded">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? 'Update' : 'Create Data Source'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

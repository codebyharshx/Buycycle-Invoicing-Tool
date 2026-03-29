'use client';

/**
 * Vendor Modal Component
 * Dialog for creating and editing vendors
 */

import { useState, useEffect } from 'react';
import type {
  Vendor,
  CreateVendorRequest,
  UpdateVendorRequest,
  VendorService,
  PaymentTermsType,
} from '@shared/types';
import { VENDOR_SERVICES, PAYMENT_TERMS_LABELS } from '@shared/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';

interface VendorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: Vendor | null;
  onSave: (data: CreateVendorRequest | UpdateVendorRequest) => Promise<void>;
}

const PAYMENT_TERMS_OPTIONS: PaymentTermsType[] = [
  'no_due_date',
  'based_on_invoice',
  '14_days',
  '30_days',
  'custom',
];

export function VendorModal({
  open,
  onOpenChange,
  vendor,
  onSave,
}: VendorModalProps) {
  const isEditMode = !!vendor;

  // Form state
  const [name, setName] = useState('');
  const [services, setServices] = useState<VendorService[]>([]);
  const [paymentTermsType, setPaymentTermsType] = useState<PaymentTermsType>('based_on_invoice');
  const [paymentTermsCustomDays, setPaymentTermsCustomDays] = useState<string>('');
  const [invoiceSource, setInvoiceSource] = useState('');
  const [shipmentType, setShipmentType] = useState('');
  const [vatInfo, setVatInfo] = useState('');
  const [invoiceFrequency, setInvoiceFrequency] = useState('');
  const [invoiceFormat, setInvoiceFormat] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate form when editing
  useEffect(() => {
    if (vendor) {
      setName(vendor.name);
      setServices(vendor.services || []);
      setPaymentTermsType(vendor.payment_terms_type);
      setPaymentTermsCustomDays(vendor.payment_terms_custom_days?.toString() || '');
      setInvoiceSource(vendor.invoice_source || '');
      setShipmentType(vendor.shipment_type || '');
      setVatInfo(vendor.vat_info || '');
      setInvoiceFrequency(vendor.invoice_frequency || '');
      setInvoiceFormat(vendor.invoice_format || '');
      setPaymentMethod(vendor.payment_method || '');
      setNotes(vendor.notes || '');
    } else {
      // Reset form for new vendor
      setName('');
      setServices([]);
      setPaymentTermsType('based_on_invoice');
      setPaymentTermsCustomDays('');
      setInvoiceSource('');
      setShipmentType('');
      setVatInfo('');
      setInvoiceFrequency('');
      setInvoiceFormat('');
      setPaymentMethod('');
      setNotes('');
    }
    setError(null);
  }, [vendor, open]);

  const toggleService = (service: VendorService) => {
    setServices((prev) =>
      prev.includes(service)
        ? prev.filter((s) => s !== service)
        : [...prev, service]
    );
  };

  const handleSubmit = async () => {
    // Validation
    if (!name.trim()) {
      setError('Vendor name is required');
      return;
    }

    if (paymentTermsType === 'custom' && !paymentTermsCustomDays) {
      setError('Please specify the number of days for custom payment terms');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const data: CreateVendorRequest | UpdateVendorRequest = {
        name: name.trim(),
        services: services.length > 0 ? services : undefined,
        payment_terms_type: paymentTermsType,
        payment_terms_custom_days:
          paymentTermsType === 'custom' ? parseInt(paymentTermsCustomDays, 10) : null,
        invoice_source: invoiceSource.trim() || null,
        shipment_type: shipmentType.trim() || null,
        vat_info: vatInfo.trim() || null,
        invoice_frequency: invoiceFrequency.trim() || null,
        invoice_format: invoiceFormat.trim() || null,
        payment_method: paymentMethod.trim() || null,
        notes: notes.trim() || null,
      };

      await onSave(data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save vendor');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Vendor' : 'Add Vendor'}</DialogTitle>
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
              placeholder="Enter vendor name"
            />
          </div>

          {/* Services */}
          <div className="grid gap-2">
            <Label>Services</Label>
            <div className="flex gap-4">
              {VENDOR_SERVICES.map((service) => (
                <div key={service} className="flex items-center gap-2">
                  <Checkbox
                    id={`service-${service}`}
                    checked={services.includes(service)}
                    onCheckedChange={() => toggleService(service)}
                  />
                  <Label
                    htmlFor={`service-${service}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {service}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Payment Terms */}
          <div className="grid gap-2">
            <Label>Payment Terms</Label>
            <div className="flex flex-col gap-2">
              {PAYMENT_TERMS_OPTIONS.map((option) => (
                <div key={option} className="flex items-center gap-2">
                  <input
                    type="radio"
                    id={`payment-${option}`}
                    name="paymentTerms"
                    checked={paymentTermsType === option}
                    onChange={() => setPaymentTermsType(option)}
                    className="h-4 w-4"
                  />
                  <Label
                    htmlFor={`payment-${option}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {PAYMENT_TERMS_LABELS[option]}
                  </Label>
                </div>
              ))}
              {paymentTermsType === 'custom' && (
                <div className="ml-6 mt-1">
                  <Input
                    type="number"
                    value={paymentTermsCustomDays}
                    onChange={(e) => setPaymentTermsCustomDays(e.target.value)}
                    placeholder="Number of days"
                    className="w-32"
                    min={1}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Invoice Source */}
          <div className="grid gap-2">
            <Label htmlFor="invoiceSource">Source of invoice</Label>
            <Input
              id="invoiceSource"
              value={invoiceSource}
              onChange={(e) => setInvoiceSource(e.target.value)}
              placeholder="e.g., Email forwarding, Portal, API"
            />
          </div>

          {/* Shipment Type */}
          <div className="grid gap-2">
            <Label htmlFor="shipmentType">Shipment type</Label>
            <Input
              id="shipmentType"
              value={shipmentType}
              onChange={(e) => setShipmentType(e.target.value)}
              placeholder="e.g., Bike parts, B2B, International"
            />
          </div>

          {/* VAT % */}
          <div className="grid gap-2">
            <Label htmlFor="vatInfo">VAT %</Label>
            <Input
              id="vatInfo"
              value={vatInfo}
              onChange={(e) => setVatInfo(e.target.value)}
              placeholder="e.g., 19%, Reverse charge, N/A"
            />
          </div>

          {/* Invoice Frequency */}
          <div className="grid gap-2">
            <Label htmlFor="invoiceFrequency">Invoice frequency</Label>
            <Input
              id="invoiceFrequency"
              value={invoiceFrequency}
              onChange={(e) => setInvoiceFrequency(e.target.value)}
              placeholder="e.g., 7 days, 30 days, unknown"
            />
          </div>

          {/* Invoice Format */}
          <div className="grid gap-2">
            <Label htmlFor="invoiceFormat">Invoice format</Label>
            <Input
              id="invoiceFormat"
              value={invoiceFormat}
              onChange={(e) => setInvoiceFormat(e.target.value)}
              placeholder="e.g., PDF, CSV"
            />
          </div>

          {/* Payment Method */}
          <div className="grid gap-2">
            <Label htmlFor="paymentMethod">Payment method</Label>
            <Input
              id="paymentMethod"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              placeholder="e.g., SEPA, Manual transfer, Unknown"
            />
          </div>

          {/* Notes */}
          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes about this vendor"
              rows={3}
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
            {isEditMode ? 'Update Vendor' : 'Add Vendor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

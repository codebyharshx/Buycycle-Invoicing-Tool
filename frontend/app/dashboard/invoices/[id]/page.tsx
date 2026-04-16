'use client';

/**
 * Invoice Detail Page
 * Shows PDF viewer and extracted invoice data
 */

import { use, useState, useEffect, useMemo, Fragment } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invoicesApi, agentsApi, type Agent } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { usePageHeader } from '@/components/providers';
import { ArrowLeft, ChevronLeft, ChevronRight, AlertTriangle, Download, ZoomIn, ZoomOut, RotateCw, FileText, Table, BarChart3, ExternalLink, Link2, List, Grid3X3 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { InvoiceNotesSection } from '@/components/invoices/invoice-notes-section';
import { InvoiceTagsSection } from '@/components/invoices/invoice-tags-section';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { AssignmentDropdown } from '@/components/shared/assignment-dropdown';
import type { InvoiceExtractionRecord, InvoiceExtractionRecordWithLineItems, InvoiceLineItem, InvoiceData, InvoicePaymentMethod } from '@shared/types';
import { INVOICE_PAYMENT_METHODS } from '@shared/types';
import { formatCurrency } from '@/lib/format';
import { LineItemsSpreadsheet } from '@/components/invoices/line-items-spreadsheet';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function InvoiceDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { setHeader } = usePageHeader();
  const [zoom, setZoom] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const queryClient = useQueryClient();
  // User email - placeholder for now, can be replaced with actual auth later
  const userEmail = 'user@buycycle.com';
  const [agents, setAgents] = useState<Agent[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [lineItemsViewMode, setLineItemsViewMode] = useState<'list' | 'spreadsheet'>('spreadsheet');

  // Fetch agents for assignment
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const result = await agentsApi.list();
        setAgents(result.data);
      } catch (error) {
        console.error('Failed to fetch agents:', error);
      }
    };
    void fetchAgents();
  }, []);

  // Get agent by ID
  const getAgentById = (agentId: number | null): Agent | undefined => {
    if (!agentId) return undefined;
    return agents.find(agent => agent.id === agentId);
  };

  // Set provisional header with back button
  useEffect(() => {
    const headerLeft = (
      <Link href="/dashboard/invoices">
        <Button variant="ghost" size="icon">
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </Link>
    );
    setHeader({ title: 'Invoice', left: headerLeft });
  }, [setHeader]);

  // Fetch invoice details (with line items if applicable)
  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => invoicesApi.get(Number(id), true), // Always fetch with line items
  });

  // Fetch linked invoices (credit notes, surcharges linked to this invoice)
  const { data: linkedInvoices } = useQuery({
    queryKey: ['invoice-linked', id],
    queryFn: () => invoicesApi.getLinkedInvoices(Number(id)),
    enabled: !!invoice,
  });

  // Reset pagination when invoice changes
  useEffect(() => {
    setCurrentPage(1);
  }, [id]);

  // Debug logging (development only)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && invoice) {
      const lineItems = 'line_items' in invoice ? (invoice as { line_items?: unknown[] }).line_items : undefined;
      console.log('📊 Invoice Data:', {
        id: invoice.id,
        has_line_items: invoice.has_line_items,
        line_items_in_object: 'line_items' in invoice,
        line_items_count: lineItems && Array.isArray(lineItems) ? lineItems.length : 0,
        invoice_number: invoice.invoice_number,
      });
    }
  }, [invoice]);

  const detectedVendor = useMemo(() => {
    if (!invoice) return '';
    const consensusVendor = invoice.consensus_data?.vendor;
    if (typeof consensusVendor === 'string' && consensusVendor.trim() !== '') {
      return consensusVendor;
    }
    const firstRawVendor = Object.values(invoice.raw_results || {}).find(
      (result): result is InvoiceData =>
        !!result && typeof result.vendor === 'string' && result.vendor.trim() !== ''
    );
    return firstRawVendor?.vendor || '';
  }, [invoice]);

  const detectedCurrency = useMemo(() => {
    if (!invoice) return 'EUR';
    const consensusCurrency = invoice.consensus_data?.currency;
    if (typeof consensusCurrency === 'string' && consensusCurrency.trim() !== '') {
      return consensusCurrency;
    }
    const firstRawCurrency = Object.values(invoice.raw_results || {}).find(
      (result): result is InvoiceData =>
        !!result && typeof result.currency === 'string' && result.currency.trim() !== ''
    );
    return firstRawCurrency?.currency || 'EUR';
  }, [invoice]);

  const lineItemsForInsights: InvoiceLineItem[] = useMemo(() => {
    if (!invoice || !invoice.has_line_items || !('line_items' in invoice)) return [];
    const typed = invoice as InvoiceExtractionRecordWithLineItems;
    return Array.isArray(typed.line_items) ? typed.line_items : [];
  }, [invoice]);

  const isDHLInvoice = useMemo(() => detectedVendor.toLowerCase().includes('dhl'), [detectedVendor]);

  const dhlInsights = useMemo(() => {
    if (!isDHLInvoice || lineItemsForInsights.length === 0) return null;

    const shipmentsCount = lineItemsForInsights.length;
    let netSum = 0;
    let surchargeSum = 0;
    let weightSum = 0;
    let weightCount = 0;

    const surchargeMap = new Map<string, { count: number; total: number }>();
    const productMap = new Map<string, { count: number; total: number }>();

    const extractCharges = (item: InvoiceLineItem): { name: string; amount: number }[] => {
      const charges: { name: string; amount: number }[] = [];
      for (let idx = 1; idx <= 9; idx += 1) {
        const nameKey = `xc${idx}_name` as keyof InvoiceLineItem;
        const amountKey = `xc${idx}_charge` as keyof InvoiceLineItem;
        const nameValue = item[nameKey];
        const amountValue = item[amountKey];
        if (typeof nameValue !== 'string') continue;
        const trimmedName = nameValue.trim();
        if (trimmedName === '') continue;
        if (typeof amountValue !== 'number') continue;
        charges.push({ name: trimmedName, amount: amountValue });
      }
      return charges;
    };

    lineItemsForInsights.forEach((item) => {
      const netAmount = typeof item.net_amount === 'number' ? item.net_amount : 0;
      netSum += netAmount;

      const charges = extractCharges(item);
      const chargesSum = charges.reduce((sum, charge) => sum + charge.amount, 0);
      const itemSurcharge = typeof item.total_surcharges === 'number' ? item.total_surcharges : chargesSum;
      surchargeSum += itemSurcharge;

      if (typeof item.weight_kg === 'number') {
        weightSum += item.weight_kg;
        weightCount += 1;
      }

      const productName = item.product_name?.trim() || 'Unknown product';
      const productEntry = productMap.get(productName) || { count: 0, total: 0 };
      productEntry.count += 1;
      productEntry.total += netAmount;
      productMap.set(productName, productEntry);

      charges.forEach(({ name, amount }) => {
        if (!Number.isFinite(amount)) return;
        const current = surchargeMap.get(name) || { count: 0, total: 0 };
        current.count += 1;
        current.total += amount;
        surchargeMap.set(name, current);
      });
    });

    const surchargeFrequency = Array.from(surchargeMap.entries())
      .map(([name, info]) => ({ name, count: info.count, total: info.total }))
      .sort((a, b) => b.count - a.count);

    const surchargeAverage = surchargeFrequency
      .map((item) => ({
        name: item.name,
        average: item.count > 0 ? item.total / item.count : 0,
      }))
      .sort((a, b) => b.average - a.average);

    const productAverage = Array.from(productMap.entries())
      .map(([name, info]) => ({
        name,
        average: info.count > 0 ? info.total / info.count : 0,
      }))
      .sort((a, b) => b.average - a.average);

    return {
      shipmentsCount,
      avgPricePerShipment: shipmentsCount > 0 ? netSum / shipmentsCount : 0,
      avgSurchargePerShipment: shipmentsCount > 0 ? surchargeSum / shipmentsCount : 0,
      avgWeightPerShipment: weightCount > 0 ? weightSum / weightCount : 0,
      totalSurcharges: surchargeSum,
      surchargeFrequency,
      surchargeAverage,
      productAverage,
    };
  }, [isDHLInvoice, lineItemsForInsights]);

  // CSV Export function
  const exportInvoiceToCSV = () => {
    if (!invoice) return;

    // Helper to get consensus value
    const getValue = (field: string): string => {
      const val = invoice.consensus_data?.[field];
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    };

    // Build CSV content
    const lines: string[] = [];

    // Invoice Metadata Section
    lines.push('=== INVOICE METADATA ===');
    lines.push('');
    lines.push(`Vendor,${getValue('vendor')}`);
    lines.push(`Account Number,${getValue('account_number')}`);
    lines.push(`Invoice Number,${getValue('invoice_number')}`);
    lines.push(`Document Type,${getValue('document_type')}`);
    lines.push(`Invoice Date,${getValue('invoice_date')}`);
    lines.push(`Due Date,${getValue('due_date')}`);
    lines.push(`Performance Period Start,${getValue('performance_period_start')}`);
    lines.push(`Performance Period End,${getValue('performance_period_end')}`);
    lines.push(`Currency,${getValue('currency')}`);
    lines.push(`Net Amount,${getValue('net_amount')}`);
    lines.push(`VAT Amount,${getValue('vat_amount')}`);
    lines.push(`VAT Percentage,${getValue('vat_percentage')}`);
    lines.push(`Gross Amount,${getValue('gross_amount')}`);
    lines.push(`Confidence Score,${invoice.confidence_score?.toFixed(1)}%`);
    lines.push(`Models Used,${invoice.models_used?.join(', ') || ''}`);
    lines.push(`Status,${invoice.status}`);
    lines.push(`File Name,${invoice.file_name}`);
    lines.push('');

    // Line Items Section (if available)
    if (invoice.has_line_items && 'line_items' in invoice) {
      const typedInvoice = invoice as InvoiceExtractionRecordWithLineItems;
      const lineItems = typedInvoice.line_items || [];

      if (lineItems.length > 0) {
        lines.push('=== LINE ITEMS ===');
        lines.push('');

        // Header row
        const headers = [
          'Shipment Number', 'Shipment Reference 1', 'Shipment Date', 'Product Name',
          'Sender City', 'Sender Postcode', 'Receiver City', 'Receiver Postcode',
          'Weight (kg)', 'Weight Flag', 'Pieces', 'Base Price', 'Total Surcharges',
          'XC1 Name', 'XC1 Charge', 'XC2 Name', 'XC2 Charge', 'XC3 Name', 'XC3 Charge',
          'XC4 Name', 'XC4 Charge', 'XC5 Name', 'XC5 Charge', 'XC6 Name', 'XC6 Charge',
          'XC7 Name', 'XC7 Charge', 'XC8 Name', 'XC8 Charge', 'XC9 Name', 'XC9 Charge',
          'Net Amount', 'Tax', 'Gross Amount'
        ];
        lines.push(headers.join(','));

        // Data rows
        lineItems.forEach((item: InvoiceLineItem) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawData = (item as any).vendor_raw_data || {};
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const itemAny = item as any;

          // Get XC data
          const getXC = (n: number) => {
            const name = rawData[`xc${n}_name`] || itemAny[`xc${n}_name`] || '';
            const charge = rawData[`xc${n}_charge`] ?? itemAny[`xc${n}_charge`] ?? '';
            return { name, charge };
          };

          const escapeCSV = (val: string | number | null | undefined): string => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          };

          const row = [
            escapeCSV(item.shipment_number),
            escapeCSV(item.shipment_reference_1),
            escapeCSV(item.shipment_date),
            escapeCSV(item.product_name),
            escapeCSV(item.origin_city),
            escapeCSV(item.origin_postal_code),
            escapeCSV(item.destination_city),
            escapeCSV(item.destination_postal_code),
            escapeCSV(item.weight_kg),
            escapeCSV(item.weight_flag),
            escapeCSV(item.pieces),
            escapeCSV(item.base_price),
            escapeCSV(item.total_surcharges),
            escapeCSV(getXC(1).name), escapeCSV(getXC(1).charge),
            escapeCSV(getXC(2).name), escapeCSV(getXC(2).charge),
            escapeCSV(getXC(3).name), escapeCSV(getXC(3).charge),
            escapeCSV(getXC(4).name), escapeCSV(getXC(4).charge),
            escapeCSV(getXC(5).name), escapeCSV(getXC(5).charge),
            escapeCSV(getXC(6).name), escapeCSV(getXC(6).charge),
            escapeCSV(getXC(7).name), escapeCSV(getXC(7).charge),
            escapeCSV(getXC(8).name), escapeCSV(getXC(8).charge),
            escapeCSV(getXC(9).name), escapeCSV(getXC(9).charge),
            escapeCSV(item.net_amount),
            escapeCSV(item.total_tax),
            escapeCSV(item.gross_amount),
          ];
          lines.push(row.join(','));
        });
      }
    }

    // Create and download the CSV file
    const csvContent = lines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const fileName = `invoice_${getValue('invoice_number') || invoice.id}_${new Date().toISOString().split('T')[0]}.csv`;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success('CSV exported successfully');
  };

  // Status badge helper
  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { label: 'Pending Approval', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
      approved: { label: 'Approved', color: 'bg-green-100 text-green-800 border-green-300' },
      on_hold: { label: 'On Hold', color: 'bg-orange-100 text-orange-800 border-orange-300' },
      rejected: { label: 'Deleted', color: 'bg-red-100 text-red-800 border-red-300' },
      paid: { label: 'Paid', color: 'bg-blue-100 text-blue-800 border-blue-300' },
    };
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    return (
      <Badge variant="outline" className={`${config.color} font-medium`}>
        {config.label}
      </Badge>
    );
  };

  // Get current user's agent ID from the agents list
  // Falls back to a hash of the email if no matching agent found
  const getCurrentUserAgentId = (): number => {
    const email = userEmail || 'default@user';
    const currentAgent = agents.find(agent => agent.email === email);
    if (currentAgent) return currentAgent.id;
    // Generate a consistent ID from email hash for users not in agents list
    let hash = 0;
    for (let i = 0; i < email.length; i++) {
      hash = ((hash << 5) - hash) + email.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % 10000 + 1000; // Returns ID between 1000-10999
  };

  // Update global title when invoice data is available
  useEffect(() => {
    // Helper to get value with fallback to conflicts_data._final_value
    const getValueForTitle = (field: string): string => {
      const consensusValue = invoice?.consensus_data[field];
      if (consensusValue) return consensusValue as string;
      const conflict = invoice?.conflicts_data?.[field];
      if (conflict && typeof conflict === 'object' && '_final_value' in conflict) {
        return conflict._final_value as string;
      }
      return '';
    };
    const vendorName = getValueForTitle('vendor');
    const invoiceNum = getValueForTitle('invoice_number');

    const title = invoice ? (
      <div className="flex items-center gap-2">
        <span>
          {vendorName && vendorName !== '-' ? `${vendorName} - ` : ''}
          {invoiceNum || invoice.file_name}
        </span>
        {getStatusBadge(invoice.status)}
      </div>
    ) : 'Invoice';
    const headerRight = (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm">
          <ChevronLeft className="h-4 w-4 mr-1" />
          Previous Invoice
        </Button>
        <Button variant="outline" size="sm">
          Next Invoice
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    );
    const headerLeft = (
      <Link href="/dashboard/invoices">
        <Button variant="ghost" size="icon">
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </Link>
    );
    setHeader({ title, left: headerLeft, right: headerRight });
  }, [invoice, setHeader]);

  async function saveFieldWithRetry(field: string, value: unknown, maxRetries = 5): Promise<void> {
    let attempt = 0;
    let delayMs = 300;
    let lastError: unknown = null;
    while (attempt < maxRetries) {
      try {
        await invoicesApi.update(Number(id), {
          consensus_data: { [field]: value as string | number | string[], assigned_to: userEmail },
        });
        // Optimistic local cache update
        queryClient.setQueryData(['invoice', id], (prev: InvoiceExtractionRecord | undefined) => {
          if (!prev) return prev;
          const next: InvoiceExtractionRecord = {
            ...prev,
            consensus_data: { ...prev.consensus_data, [field]: value as string | number | string[], assigned_to: userEmail }
          };
          if (next.conflicts_data && field in next.conflicts_data) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [field]: _, ...rest } = next.conflicts_data;
            next.conflicts_data = rest;
          }
          return next;
        });
        // Show success toast for invoice number updates
        if (field === 'account_number') {
          toast.success('Invoice number updated successfully');
        }
        return;
      } catch (err: unknown) {
        // Handle duplicate invoice number error (409 Conflict)
        if (typeof err === 'object' && err !== null && 'response' in err) {
          const axiosError = err as { response?: { status?: number; data?: { message?: string } } };
          if (axiosError.response?.status === 409 && field === 'account_number') {
            const errorData = axiosError.response.data;
            toast.error('Duplicate Invoice Number', {
              description: errorData?.message || 'This invoice number already exists in another record',
            });
            // Don't retry on 409 errors
            throw err;
          }
        }
        lastError = err;
        attempt += 1;
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs = Math.min(5000, delayMs * 2);
      }
    }
    // Show generic error toast
    toast.error('Failed to save field', {
      description: lastError instanceof Error ? lastError.message : 'Please try again',
    });
    throw lastError instanceof Error ? lastError : new Error('Failed to save field');
  }

  // Format date for display in DD/MM/YYYY format (European standard)
  // Used for text input display - we control the format, not browser locale
  function formatDateForDisplay(dateStr: string): string {
    if (!dateStr || dateStr === '-' || dateStr === '') return '';

    // Already in DD/MM/YYYY format with correct structure
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
      const [first, second] = dateStr.split('/').map(n => parseInt(n, 10));
      // If it looks like it's already DD/MM/YYYY (first > 12 or second <= 12)
      if (first > 12 || second <= 12) {
        return dateStr; // Already correct
      }
    }

    // Handle YYYY-MM-DD format (ISO) → DD/MM/YYYY
    const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return `${day}/${month}/${year}`;
    }

    // Handle "Month DD, YYYY" format (e.g., "October 18, 2025") → DD/MM/YYYY
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const americanMatch = dateStr.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (americanMatch) {
      const [, monthName, day, year] = americanMatch;
      const monthIndex = monthNames.findIndex(m => m.toLowerCase() === monthName.toLowerCase());
      if (monthIndex !== -1) {
        const month = String(monthIndex + 1).padStart(2, '0');
        return `${day.padStart(2, '0')}/${month}/${year}`;
      }
    }

    // Handle DD.MM.YYYY format (European with dots) → DD/MM/YYYY
    const europeanDotMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (europeanDotMatch) {
      const [, day, month, year] = europeanDotMatch;
      return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    }

    // Handle DD/MM/YYYY or MM/DD/YYYY format (with slashes)
    const slashMatch = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (slashMatch) {
      const [, first, second, year] = slashMatch;

      // If second > 12, it MUST be MM/DD/YYYY (US format) → convert to DD/MM/YYYY
      if (parseInt(second, 10) > 12) {
        return `${second.padStart(2, '0')}/${first.padStart(2, '0')}/${year}`;
      }

      // If first > 12, it MUST be DD/MM/YYYY (European) → keep as is
      if (parseInt(first, 10) > 12) {
        return `${first.padStart(2, '0')}/${second.padStart(2, '0')}/${year}`;
      }

      // Ambiguous case (both ≤ 12): Assume European DD/MM/YYYY
      return `${first.padStart(2, '0')}/${second.padStart(2, '0')}/${year}`;
    }

    return '';
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading invoice...</p>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Failed to load invoice. {error instanceof Error ? error.message : 'Please try again.'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Helper function to get value from either consensus_data or conflicts_data._final_value
  const getValue = (field: string, defaultValue: string | number = '-') => {
    const consensusValue = invoice.consensus_data[field];
    if (consensusValue !== null && consensusValue !== undefined && consensusValue !== '' && consensusValue !== 0) {
      return consensusValue;
    }
    // Fallback to conflicts_data._final_value if consensus is empty
    const conflict = invoice.conflicts_data?.[field];
    if (conflict && typeof conflict === 'object' && '_final_value' in conflict) {
      return conflict._final_value;
    }
    return defaultValue;
  };

  const vendor = (getValue('vendor', '-') as string);
  const accountNr = (getValue('account_number', '-') as string);
  const invoiceNumber = (getValue('invoice_number', '-') as string);
  const documentType = (getValue('document_type', 'Standard Invoice') as string);
  const netAmount = (getValue('net_amount', 0) as number);
  const vatAmount = (getValue('vat_amount', 0) as number);
  const vatPercentage = (getValue('vat_percentage', 0) as number);
  const grossAmount = (getValue('gross_amount', 0) as number);
  const currency = (getValue('currency', 'EUR') as string);
  const issuedDate = (getValue('invoice_date', '-') as string);
  const dueDate = (getValue('due_date', '-') as string);
  const performancePeriodStart = (getValue('performance_period_start', '-') as string);
  const performancePeriodEnd = (getValue('performance_period_end', '-') as string);

  const hasConflicts = invoice.conflicts_data && Object.keys(invoice.conflicts_data).length > 0;
  const needsReview = invoice.confidence_score < 80 || hasConflicts;

  const pdfUrl = `/api/invoice-ocr/file/${id}`;

  // Agreement computation utilities
  type ModelKey = 'mistral' | 'gemini' | 'claude' | string;
  function getModelValue(model: ModelKey, field: string): unknown {
    const data = invoice?.raw_results[model as string];
    return data ? data[field as keyof typeof data] : undefined;
  }
  function toTitleCase(input: string): string {
    return input
      .toLowerCase()
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ');
  }

  function normalizeForCompare(_field: string, value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'string') return toTitleCase(value.trim());
    if (typeof value === 'number') return value.toFixed(2); // standardize numeric precision
    return String(value);
  }

  function getAgreement(field: string): { level: 'green' | 'yellow' | 'red'; values: Array<{ model: string; value: unknown; ok: boolean }>; majority?: unknown } {
    const models: ModelKey[] = Object.keys(invoice?.raw_results || {});
    const values = models.map((m) => ({ model: m, value: getModelValue(m, field) }));
    const normalized = values.map(v => normalizeForCompare(field, v.value));
    const counts: Record<string, number> = {};
    normalized.forEach((v) => { if (v !== null) counts[v] = (counts[v] || 0) + 1; });
    const maxCount = Object.values(counts).reduce((a, b) => Math.max(a, b), 0);
    const okValue = Object.keys(counts).find((k) => counts[k] === maxCount) ?? null;

    // Find the actual raw value that corresponds to the majority normalized value
    const majorityRawValue = okValue ? values.find(v => normalizeForCompare(field, v.value) === okValue)?.value : null;

    const enriched = values.map(v => {
      const display = typeof v.value === 'string' ? toTitleCase(v.value) : (v.value ?? 'Not found');
      const cmp = normalizeForCompare(field, v.value);
      return { model: v.model, value: display, ok: okValue !== null && cmp === okValue };
    });
    let level: 'green' | 'yellow' | 'red' = 'red';
    if (maxCount >= 3) level = 'green';
    else if (maxCount === 2) level = 'yellow';
    else level = 'red';
    return { level, values: enriched, majority: majorityRawValue || null };
  }

  function AgreementDot({ field }: { field: string }) {
    const { level, values } = getAgreement(field);
    const color = level === 'green' ? 'bg-green-500' : level === 'yellow' ? 'bg-yellow-500' : 'bg-red-500';
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-block w-2 h-2 rounded-full ${color} ml-1`} />
        </TooltipTrigger>
        <TooltipContent className="text-xs text-white">
          <div className="space-y-1">
            {values.map(v => (
              <div key={v.model} className="flex items-center gap-1">
                <span className="capitalize min-w-[56px]">{v.model}</span>
                <span>{v.ok ? '✓' : '✗'}</span>
                <span className="">- {String(v.value)}</span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header content is provided by usePageHeader; removed local header bar */}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* PDF Viewer / Table View */}
        <div className="flex-1 bg-neutral-50 p-3 flex flex-col min-h-0">
          {/* Tabs for switching between PDF and Table (only show if has line items) */}
          {invoice.has_line_items && 'line_items' in invoice && (invoice as InvoiceExtractionRecordWithLineItems).line_items ? (
            <Tabs defaultValue="pdf" className="flex-1 flex flex-col min-h-0">
              <TabsList className="mb-2 flex-shrink-0">
                <TabsTrigger value="pdf" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Invoice PDF
                </TabsTrigger>
                <TabsTrigger value="table" className="flex items-center gap-2">
                  <Table className="h-4 w-4" />
                  Line Items ({(invoice as InvoiceExtractionRecordWithLineItems).line_items.length})
                </TabsTrigger>
                {isDHLInvoice && lineItemsForInsights.length > 0 && (
                  <TabsTrigger value="insights" className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    DHL Insights
                  </TabsTrigger>
                )}
              </TabsList>

              {/* PDF View Tab */}
              <TabsContent value="pdf" className="flex-1 flex flex-col mt-0 min-h-0">
          {/* Compact toolbar with model confidence bar */}
          <div className="bg-white border rounded-md px-2.5 py-1.5 mb-2.5 space-y-1.5">
            {/* Controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => setZoom(Math.max(50, zoom - 10))}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-[11px] font-medium w-9 text-center">{zoom}%</span>
                <Button variant="ghost" size="icon" onClick={() => setZoom(Math.min(200, zoom + 10))}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="h-4" />
              <Button variant="ghost" size="icon">
                <RotateCw className="h-4 w-4" />
              </Button>
              <span className="text-[11px] text-gray-500 ml-1">1 Page</span>
              </div>
              <Button variant="outline" size="sm" className="h-8">
                <Download className="h-4 w-4 mr-1" />
                Download
              </Button>
            </div>

            {/* Model confidence bar */}
            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="text-[11px] text-gray-600 mr-1">Models called:</span>
              {Object.keys(invoice.raw_results).map((model) => {
                const ok = !!invoice.raw_results[model];
                const modelNames: Record<string, string> = {
                  'deepseek': 'DeepSeek',
                  'mistral': 'Mistral',
                  'gemini': 'Gemini',
                  'claude': 'Claude',
                };
                return (
                  <div key={model} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border bg-white"
                       title={`${modelNames[model] || model}: ${ok ? 'Extraction successful' : 'Failed to extract'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="font-medium">{modelNames[model] || model}</span>
                  </div>
                );
              })}
              <div className="ml-auto text-[11px] flex items-center gap-1 px-2 py-1 rounded border bg-white">
                <span className="text-gray-600">Overall Confidence:</span>
                <span className={`font-semibold ${invoice.confidence_score >= 80 ? 'text-green-600' : invoice.confidence_score >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {invoice.confidence_score.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* PDF Viewer */}
          <div className="bg-white border rounded-md overflow-hidden" style={{ height: 'calc(100vh - 200px)' }}>
            <iframe
              src={pdfUrl}
              className="w-full h-full border-0"
              style={{ zoom: `${zoom}%` }}
              title={`Invoice ${invoice.file_name}`}
            />
          </div>
              </TabsContent>

              {/* Table View Tab */}
              <TabsContent value="table" className="flex-1 mt-0 flex flex-col min-h-0">
                {(() => {
                  // Line items are already sorted by date ASC from the backend
                  const lineItems = (invoice as InvoiceExtractionRecordWithLineItems).line_items;

                  const totalItems = lineItems.length;
                  const totalPages = Math.ceil(totalItems / itemsPerPage);
                  const startIndex = (currentPage - 1) * itemsPerPage;
                  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
                  const currentItems = lineItems.slice(startIndex, endIndex);

                  // Performance period is now auto-calculated by backend and stored in consensus_data
                  // Fallback to first/last line item dates if not in consensus_data
                  const firstDate = performancePeriodStart !== '-' ? performancePeriodStart : (lineItems.length > 0 ? lineItems[0].shipment_date : null);
                  const lastDate = performancePeriodEnd !== '-' ? performancePeriodEnd : (lineItems.length > 0 ? lineItems[lineItems.length - 1].shipment_date : null);

                  return (
                    <>
                      {/* Performance Period + View Toggle */}
                      <div className="flex items-center justify-between gap-2 mb-2 flex-shrink-0">
                        {/* Performance Period from Line Items */}
                        {firstDate && lastDate && (
                          <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 flex-1">
                            <div className="text-xs text-blue-700">
                              <span className="font-medium">Performance Period:</span>{' '}
                              {firstDate} — {lastDate}
                              <span className="text-blue-600 ml-2">({totalItems} transactions)</span>
                            </div>
                          </div>
                        )}
                        {/* View Mode Toggle */}
                        <div className="flex items-center gap-1 bg-white border rounded-md p-1">
                          <Button
                            variant={lineItemsViewMode === 'list' ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => setLineItemsViewMode('list')}
                            className="h-7 text-xs px-2"
                          >
                            <List className="h-3.5 w-3.5 mr-1" />
                            List
                          </Button>
                          <Button
                            variant={lineItemsViewMode === 'spreadsheet' ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => setLineItemsViewMode('spreadsheet')}
                            className="h-7 text-xs px-2"
                          >
                            <Grid3X3 className="h-3.5 w-3.5 mr-1" />
                            Spreadsheet
                          </Button>
                        </div>
                      </div>

                      {/* Spreadsheet View */}
                      {lineItemsViewMode === 'spreadsheet' && (
                        <div className="flex-1 bg-white rounded-lg border overflow-hidden min-h-0">
                          <LineItemsSpreadsheet
                            lineItems={lineItems}
                            currency={detectedCurrency}
                          />
                        </div>
                      )}

                      {/* List View (original) */}
                      {lineItemsViewMode === 'list' && (
                        <>
                      {/* Pagination Controls - Top */}
                      <div className="bg-white border rounded-md px-3 py-2 mb-2 flex items-center justify-between flex-shrink-0">
                        <div className="text-xs text-gray-600">
                          Showing <span className="font-semibold">{startIndex + 1}</span> to <span className="font-semibold">{endIndex}</span> of <span className="font-semibold">{totalItems}</span> shipments
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="h-8"
                          >
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            Previous
                          </Button>
                          <span className="text-xs text-gray-600 px-2">
                            Page <span className="font-semibold">{currentPage}</span> of <span className="font-semibold">{totalPages}</span>
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="h-8"
                          >
                            Next
                            <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                        </div>
                      </div>

                      {/* Table */}
                      <div className="bg-white rounded-lg border flex-1 overflow-auto min-h-0">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 border-b sticky top-0">
                            <tr>
                              <th className="px-1 py-2 text-center font-medium text-gray-400 w-8">▼</th>
                              <th className="px-1 py-2 text-left font-medium text-gray-600 text-[10px]">Shipment #</th>
                              <th className="px-1 py-2 text-left font-medium text-gray-600 text-[10px]">Ref</th>
                              <th className="px-1 py-2 text-left font-medium text-gray-600 text-[10px]">Shipment Date</th>
                              <th className="px-1 py-2 text-left font-medium text-gray-600 text-[10px]">Product Name</th>
                              <th className="px-1 py-2 text-left font-medium text-gray-600 text-[10px]" title="Sender Name/City">Sender</th>
                              <th className="px-1 py-2 text-left font-medium text-gray-600 text-[10px]" title="Sender Postcode">Sender PC</th>
                              <th className="px-1 py-2 text-left font-medium text-gray-600 text-[10px]" title="Receiver Name/City">Receiver</th>
                              <th className="px-1 py-2 text-left font-medium text-gray-600 text-[10px]" title="Receiver Postcode">Receiver PC</th>
                              <th className="px-1 py-2 text-right font-medium text-gray-600 text-[10px]">Weight</th>
                              <th className="px-1 py-2 text-center font-medium text-gray-600 text-[10px]" title="Weight Flag: A=Actual, B=Billed, V=Volume, W=DHL Vol">Flag</th>
                              <th className="px-1 py-2 text-right font-medium text-gray-600 text-[10px]">Pcs</th>
                              <th className="px-1 py-2 text-right font-medium text-gray-600 text-[10px]" title="Base Price / Weight Charge">Base</th>
                              <th className="px-1 py-2 text-right font-medium text-gray-600 text-[10px]" title="Total Extra Charges">XC Tot</th>
                              <th className="px-1 py-2 text-right font-medium text-gray-600 text-[10px]">Net</th>
                              <th className="px-1 py-2 text-right font-medium text-gray-600 text-[10px]">Tax</th>
                              <th className="px-1 py-2 text-right font-medium text-gray-600 text-[10px]">Gross</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {currentItems.map((item: InvoiceLineItem) => {
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              const rawData = (item as any).vendor_raw_data || {};
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              const itemAny = item as any;

                              // Get XC data from vendor_raw_data or direct fields
                              const getXC = (n: number) => {
                                const code = rawData[`xc${n}_code`] || null;
                                const name = rawData[`xc${n}_name`] || itemAny[`xc${n}_name`] as string | null;
                                const charge = rawData[`xc${n}_charge`] ?? itemAny[`xc${n}_charge`] as number | null;
                                return { code, name, charge };
                              };

                              // Collect all XC charges for expandable rows
                              const extraCharges: { code: string | null; name: string; amount: number }[] = [];
                              for (let i = 1; i <= 9; i++) {
                                const xc = getXC(i);
                                if (xc.name && xc.name.trim() && xc.charge !== null && xc.charge !== 0) {
                                  extraCharges.push({ code: xc.code, name: xc.name.trim(), amount: xc.charge });
                                }
                              }

                              const basePriceNum = Number(item.base_price) || 0;
                              const chargeCount = extraCharges.length + (basePriceNum > 0 ? 1 : 0);
                              const isExpanded = expandedRows.has(item.id);

                              const toggleExpand = () => {
                                setExpandedRows(prev => {
                                  const next = new Set(prev);
                                  if (next.has(item.id)) {
                                    next.delete(item.id);
                                  } else {
                                    next.add(item.id);
                                  }
                                  return next;
                                });
                              };

                              return (
                                <Fragment key={item.id}>
                                  <tr className={`hover:bg-gray-50 ${isExpanded ? 'bg-blue-50' : ''}`}>
                                    <td className="px-1 py-1.5 text-center w-8">
                                      {chargeCount > 1 ? (
                                        <button
                                          onClick={toggleExpand}
                                          className="inline-flex items-center justify-center w-6 h-6 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer"
                                          title={isExpanded ? 'Collapse charges' : `View ${chargeCount} charges`}
                                        >
                                          <span className={`text-blue-600 font-bold text-[10px] transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                                            {isExpanded ? '▲' : '▼'}
                                          </span>
                                        </button>
                                      ) : (
                                        <span className="text-gray-300">·</span>
                                      )}
                                    </td>
                                    <td className="px-1 py-1.5 text-blue-600 font-mono text-[10px]">
                                      <div className="flex items-center gap-1">
                                        <span>{item.shipment_number || '-'}</span>
                                        {chargeCount > 1 && (
                                          <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-medium bg-gray-200 text-gray-700 rounded">
                                            {chargeCount}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-1 py-1.5 text-[9px] text-gray-600 font-mono">{item.shipment_reference_1 || '-'}</td>
                                    <td className="px-1 py-1.5 whitespace-nowrap text-[9px]">{item.shipment_date ? new Date(item.shipment_date).toLocaleDateString('en-GB') : '-'}</td>
                                    <td className="px-1 py-1.5 text-[9px] max-w-[100px] truncate" title={item.product_name || ''}>{item.product_name || '-'}</td>
                                    <td className="px-1 py-1.5 text-[9px] max-w-[100px] truncate" title={item.origin_city || ''}>{item.origin_city || '-'}</td>
                                    <td className="px-1 py-1.5 text-[9px] font-mono text-gray-500">{item.origin_postal_code || '-'}</td>
                                    <td className="px-1 py-1.5 text-[9px] max-w-[100px] truncate" title={item.destination_city || ''}>{item.destination_city || '-'}</td>
                                    <td className="px-1 py-1.5 text-[9px] font-mono text-gray-500">{item.destination_postal_code || '-'}</td>
                                    <td className="px-1 py-1.5 text-right font-mono text-[9px]">{item.weight_kg ? Number(item.weight_kg).toFixed(1) : '-'}</td>
                                    <td className="px-1 py-1.5 text-center text-[9px] font-mono text-gray-500">{item.weight_flag || '-'}</td>
                                    <td className="px-1 py-1.5 text-right text-[9px]">{item.pieces || '-'}</td>
                                    <td className="px-1 py-1.5 text-right font-mono text-[9px]">{item.base_price ? formatCurrency(Number(item.base_price), detectedCurrency) : '-'}</td>
                                    <td className="px-1 py-1.5 text-right font-mono text-[9px]">{item.total_surcharges ? formatCurrency(Number(item.total_surcharges), detectedCurrency) : '-'}</td>
                                    <td className="px-1 py-1.5 text-right font-mono text-[9px]">{item.net_amount ? formatCurrency(Number(item.net_amount), detectedCurrency) : '-'}</td>
                                    <td className="px-1 py-1.5 text-right font-mono text-[9px] text-gray-600">{item.total_tax ? formatCurrency(Number(item.total_tax), detectedCurrency) : '-'}</td>
                                    <td className="px-1 py-1.5 text-right font-semibold font-mono text-[9px]">{item.gross_amount ? formatCurrency(Number(item.gross_amount), detectedCurrency) : '-'}</td>
                                  </tr>
                                  {/* Expandable XC details table */}
                                  {isExpanded && (
                                    <>
                                      {/* XC Details Header */}
                                      <tr className="bg-gray-50">
                                        <td className="border-l-2 border-l-blue-400"></td>
                                        <td colSpan={16} className="px-2 py-2">
                                          <div className="overflow-x-auto">
                                            <table className="w-full text-[9px]">
                                              <thead>
                                                <tr className="text-gray-500 font-medium">
                                                  <th className="px-2 py-1 text-left">XC1 Name</th>
                                                  <th className="px-2 py-1 text-right">XC1 Charge</th>
                                                  <th className="px-2 py-1 text-left">XC2 Name</th>
                                                  <th className="px-2 py-1 text-right">XC2 Charge</th>
                                                  <th className="px-2 py-1 text-left">XC3 Name</th>
                                                  <th className="px-2 py-1 text-right">XC3 Charge</th>
                                                  <th className="px-2 py-1 text-left">XC4 Name</th>
                                                  <th className="px-2 py-1 text-right">XC4 Charge</th>
                                                  <th className="px-2 py-1 text-left">XC5 Name</th>
                                                  <th className="px-2 py-1 text-right">XC5 Charge</th>
                                                  <th className="px-2 py-1 text-left">XC6 Name</th>
                                                  <th className="px-2 py-1 text-right">XC6 Charge</th>
                                                  <th className="px-2 py-1 text-left">XC7 Name</th>
                                                  <th className="px-2 py-1 text-right">XC7 Charge</th>
                                                  <th className="px-2 py-1 text-left">XC8 Name</th>
                                                  <th className="px-2 py-1 text-right">XC8 Charge</th>
                                                  <th className="px-2 py-1 text-left">XC9 Name</th>
                                                  <th className="px-2 py-1 text-right">XC9 Charge</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                <tr className="text-gray-700">
                                                  {[1,2,3,4,5,6,7,8,9].map(n => {
                                                    const xc = getXC(n);
                                                    return (
                                                      <Fragment key={n}>
                                                        <td className="px-2 py-1 text-left">{xc.name || '0'}</td>
                                                        <td className="px-2 py-1 text-right font-mono">{xc.charge ? formatCurrency(Number(xc.charge), detectedCurrency) : '0'}</td>
                                                      </Fragment>
                                                    );
                                                  })}
                                                </tr>
                                              </tbody>
                                            </table>
                                          </div>
                                        </td>
                                      </tr>
                                      {/* Subtotal row */}
                                      <tr className="bg-blue-50 border-b border-blue-200">
                                        <td className="border-l-2 border-l-blue-500"></td>
                                        <td colSpan={13} className="px-1 py-1 pl-4 text-[9px] text-blue-700 font-semibold">Subtotal</td>
                                        <td className="px-1 py-1 text-right font-mono text-[9px] font-semibold text-blue-700">{formatCurrency(Number(item.net_amount || 0), detectedCurrency)}</td>
                                        <td className="px-1 py-1 text-right font-mono text-[9px] text-gray-500">{item.total_tax ? formatCurrency(Number(item.total_tax), detectedCurrency) : '-'}</td>
                                        <td className="px-1 py-1 text-right font-mono text-[9px] font-semibold text-blue-700">{formatCurrency(Number(item.gross_amount || 0), detectedCurrency)}</td>
                                      </tr>
                                    </>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-gray-50 border-t font-semibold sticky bottom-0">
                            <tr>
                              <td colSpan={14} className="px-1 py-2 text-right text-[9px] text-gray-600">Total ({totalItems} items):</td>
                              <td className="px-1 py-2 text-right font-mono text-[9px]">
                                {formatCurrency(lineItems.reduce((sum: number, item: InvoiceLineItem) => sum + Number(item.net_amount || 0), 0), detectedCurrency)}
                              </td>
                              <td className="px-1 py-2 text-right font-mono text-[9px] text-gray-600">
                                {formatCurrency(lineItems.reduce((sum: number, item: InvoiceLineItem) => sum + Number(item.total_tax || 0), 0), detectedCurrency)}
                              </td>
                              <td className="px-1 py-2 text-right font-mono text-[9px]">
                                {formatCurrency(lineItems.reduce((sum: number, item: InvoiceLineItem) => sum + Number(item.gross_amount || 0), 0), detectedCurrency)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      {/* Pagination Controls - Bottom */}
                      <div className="bg-white border rounded-md px-3 py-2 mt-2 flex items-center justify-between flex-shrink-0">
                        <div className="text-xs text-gray-600">
                          Showing <span className="font-semibold">{startIndex + 1}</span> to <span className="font-semibold">{endIndex}</span> of <span className="font-semibold">{totalItems}</span> shipments
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="h-8"
                          >
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            Previous
                          </Button>
                          <span className="text-xs text-gray-600 px-2">
                            Page <span className="font-semibold">{currentPage}</span> of <span className="font-semibold">{totalPages}</span>
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="h-8"
                          >
                            Next
                            <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                        </div>
                      </div>
                        </>
                      )}
                    </>
                  );
                })()}
              </TabsContent>
              {isDHLInvoice && lineItemsForInsights.length > 0 && (
                <TabsContent value="insights" className="flex-1 mt-0 flex flex-col min-h-0 overflow-auto space-y-3">
                  {dhlInsights ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="bg-white border rounded-md p-3">
                          <div className="text-xs text-gray-500">Total nr. of shipments</div>
                          <div className="text-2xl font-semibold mt-1">{dhlInsights.shipmentsCount.toLocaleString()}</div>
                        </div>
                        <div className="bg-white border rounded-md p-3">
                          <div className="text-xs text-gray-500">Avg. price per shipment</div>
                          <div className="text-2xl font-semibold mt-1">
                            {formatCurrency(dhlInsights.avgPricePerShipment, detectedCurrency)}
                          </div>
                        </div>
                        <div className="bg-white border rounded-md p-3">
                          <div className="text-xs text-gray-500">Avg. surcharge per shipment (Net amt.)</div>
                          <div className="text-2xl font-semibold mt-1">
                            {formatCurrency(dhlInsights.avgSurchargePerShipment, detectedCurrency)}
                          </div>
                        </div>
                        <div className="bg-white border rounded-md p-3">
                          <div className="text-xs text-gray-500">Avg. weight per shipment</div>
                          <div className="text-2xl font-semibold mt-1">
                            {dhlInsights.avgWeightPerShipment.toLocaleString('en-US', { maximumFractionDigits: 2 })} kg
                          </div>
                        </div>
                        <div className="bg-white border rounded-md p-3 sm:col-span-2 lg:col-span-1">
                          <div className="text-xs text-gray-500">Total surcharges</div>
                          <div className="text-2xl font-semibold mt-1">
                            {formatCurrency(dhlInsights.totalSurcharges, detectedCurrency)}
                          </div>
                        </div>
                      </div>

                      <div className="bg-white border rounded-md p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <div className="text-sm font-semibold text-gray-900">Surcharges & frequency</div>
                            <div className="text-xs text-gray-500">Across {dhlInsights.shipmentsCount.toLocaleString()} shipments</div>
                          </div>
                          <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                            Frequency
                          </Badge>
                        </div>
                        {dhlInsights.surchargeFrequency.length === 0 ? (
                          <div className="text-xs text-gray-500">No surcharges detected for this invoice.</div>
                        ) : (
                          <div className="space-y-2">
                            {(() => {
                              const maxCount = Math.max(...dhlInsights.surchargeFrequency.map((item) => item.count), 1);
                              return dhlInsights.surchargeFrequency.map(({ name, count }) => {
                                const width = Math.max(6, Math.round((count / maxCount) * 100));
                                return (
                                  <div key={name} className="flex items-center gap-3">
                                    <div className="w-48 truncate text-xs font-medium text-gray-800" title={name}>
                                      {name}
                                    </div>
                                    <div className="flex-1 bg-gray-100 rounded">
                                      <div className="h-2 rounded bg-emerald-700" style={{ width: `${width}%` }} />
                                    </div>
                                    <div className="w-10 text-right text-xs font-mono text-gray-700">{count}</div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        )}
                      </div>

                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="bg-white border rounded-md p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <div className="text-sm font-semibold text-gray-900">Avg. cost per surcharge</div>
                              <div className="text-xs text-gray-500">Average net cost per surcharge type</div>
                            </div>
                            <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                              Avg price per surcharge
                            </Badge>
                          </div>
                          {dhlInsights.surchargeAverage.length === 0 ? (
                            <div className="text-xs text-gray-500">No surcharge costs available.</div>
                          ) : (
                            <div className="space-y-2">
                              {(() => {
                                const maxAvg = Math.max(
                                  ...dhlInsights.surchargeAverage.map((item) => Math.abs(item.average)),
                                  1
                                );
                                return dhlInsights.surchargeAverage.map(({ name, average }) => {
                                  const width = Math.max(6, Math.round((Math.abs(average) / maxAvg) * 100));
                                  return (
                                    <div key={name} className="flex items-center gap-3">
                                      <div className="w-48 truncate text-xs font-medium text-gray-800" title={name}>
                                        {name}
                                      </div>
                                      <div className="flex-1 bg-gray-100 rounded">
                                        <div
                                          className={`h-2 rounded ${average >= 0 ? 'bg-emerald-700' : 'bg-orange-500'}`}
                                          style={{ width: `${width}%` }}
                                        />
                                      </div>
                                      <div className="w-24 text-right text-xs font-mono text-gray-700">
                                        {formatCurrency(average, detectedCurrency)}
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          )}
                        </div>
                        <div className="bg-white border rounded-md p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <div className="text-sm font-semibold text-gray-900">Avg. cost per shipment by product</div>
                              <div className="text-xs text-gray-500">Net average by product</div>
                            </div>
                          </div>
                          {dhlInsights.productAverage.length === 0 ? (
                            <div className="text-xs text-gray-500">No product data available.</div>
                          ) : (
                            <div className="space-y-2">
                              {(() => {
                                const maxAvg = Math.max(
                                  ...dhlInsights.productAverage.map((item) => Math.abs(item.average)),
                                  1
                                );
                                return dhlInsights.productAverage.map(({ name, average }) => {
                                  const width = Math.max(6, Math.round((Math.abs(average) / maxAvg) * 100));
                                  return (
                                    <div key={name} className="flex items-center gap-3">
                                      <div className="w-48 truncate text-xs font-medium text-gray-800" title={name}>
                                        {name}
                                      </div>
                                      <div className="flex-1 bg-gray-100 rounded">
                                        <div className="h-2 rounded bg-emerald-700" style={{ width: `${width}%` }} />
                                      </div>
                                      <div className="w-24 text-right text-xs font-mono text-gray-700">
                                        {formatCurrency(average, detectedCurrency)}
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="bg-white border rounded-md p-6 text-sm text-gray-600">
                      DHL insights are not available for this invoice.
                    </div>
                  )}
                </TabsContent>
              )}
            </Tabs>
          ) : (
            /* No line items - show PDF only without tabs */
            <>
              <div className="bg-white border rounded-md px-2.5 py-1.5 mb-2.5 space-y-1.5">
                {/* Same toolbar for non-line-items invoices */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setZoom(Math.max(50, zoom - 10))}>
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                    <span className="text-[11px] font-medium w-9 text-center">{zoom}%</span>
                    <Button variant="ghost" size="icon" onClick={() => setZoom(Math.min(200, zoom + 10))}>
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                    <Separator orientation="vertical" className="h-4" />
                    <Button variant="ghost" size="icon">
                      <RotateCw className="h-4 w-4" />
                    </Button>
                    <span className="text-[11px] text-gray-500 ml-1">1 Page</span>
                  </div>
                  <Button variant="outline" size="sm" className="h-8">
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </Button>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto">
                  <span className="text-[11px] text-gray-600 mr-1">Models called:</span>
                  {Object.keys(invoice.raw_results).map((model) => {
                    const ok = !!invoice.raw_results[model];
                    const modelNames: Record<string, string> = {
                      'deepseek': 'DeepSeek',
                      'mistral': 'Mistral',
                      'gemini': 'Gemini',
                      'claude': 'Claude',
                    };
                    return (
                      <div key={model} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border bg-white"
                           title={`${modelNames[model] || model}: ${ok ? 'Extraction successful' : 'Failed to extract'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className="font-medium">{modelNames[model] || model}</span>
                      </div>
                    );
                  })}
                  <div className="ml-auto text-[11px] flex items-center gap-1 px-2 py-1 rounded border bg-white">
                    <span className="text-gray-600">Overall Confidence:</span>
                    <span className={`font-semibold ${invoice.confidence_score >= 80 ? 'text-green-600' : invoice.confidence_score >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {invoice.confidence_score.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
              <div className="bg-white border rounded-md overflow-hidden flex-1">
                <iframe
                  src={pdfUrl}
                  className="w-full h-full border-0"
                  style={{ zoom: `${zoom}%` }}
                  title={`Invoice ${invoice.file_name}`}
                />
              </div>
            </>
          )}
        </div>

        {/* Invoice Details Panel */}
        <div className="w-[340px] bg-white border-l overflow-auto flex flex-col">
          {/* Panel header */}
          <div className="px-4 py-3 border-b sticky top-0 bg-white z-10">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">Invoice Details</h2>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={exportInvoiceToCSV}
                title="Export invoice data to CSV"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {invoice.has_line_items && (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 text-[10px] px-1.5 py-0.5">
                  CSV
                </Badge>
              )}
              {needsReview ? (
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[10px] px-1.5 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1" />
                  {(() => {
                    const conflicts = invoice.conflicts_data ? Object.keys(invoice.conflicts_data).length : 0;
                    return conflicts > 0 ? `${conflicts} field${conflicts === 1 ? '' : 's'} need review` : 'Needs review';
                  })()}
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[10px] px-1.5 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1" />
                  Ready
                </Badge>
              )}
            </div>
          </div>

          {/* AI Extraction Confidence Section */}
          <div className="px-4 py-3 bg-gray-50 border-b">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                AI Extraction Confidence
              </h3>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50">
                    View Details
                  </Button>
                </DialogTrigger>
                  <DialogContent className="w-[95vw] sm:max-w-[1100px] md:w-full md:max-w-[1100px] lg:w-full lg:max-w-[1100px] max-h-[85vh] overflow-y-auto p-4 md:p-6">
                    <DialogHeader>
                      <DialogTitle>Model Extraction Comparison</DialogTitle>
                      <DialogDescription>
                        Detailed comparison of values extracted by each AI model
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 mt-4">
                      {/* Model Summary */}
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                        <div className="text-sm">
                          <span className="font-semibold">Models Used:</span>
                          {Object.keys(invoice.raw_results).map((model, idx) => {
                            const modelNames: Record<string, string> = {
                              'deepseek': 'DeepSeek',
                              'mistral': 'Mistral',
                              'gemini': 'Gemini',
                              'claude': 'Claude',
                            };
                            return (
                              <span key={model}>
                                {idx > 0 && ', '}
                                <span className="font-medium text-blue-600">{modelNames[model] || model}</span>
                              </span>
                            );
                          })}
                        </div>
                        <div className="ml-auto text-sm">
                          <span className="font-semibold">Overall Confidence:</span>{' '}
                          <span className={`font-bold ${
                            invoice.confidence_score >= 80 ? 'text-green-600' :
                            invoice.confidence_score >= 50 ? 'text-yellow-600' : 'text-red-600'
                          }`}>
                            {invoice.confidence_score.toFixed(1)}%
                          </span>
                        </div>
                      </div>

                      {/* Comparison - Mobile Cards */}
                      <div className="md:hidden space-y-2">
                        {[
                          { key: 'vendor', label: 'Vendor' },
                          { key: 'account_number', label: 'Account Number' },
                          { key: 'document_type', label: 'Document Type' },
                          { key: 'net_amount', label: 'Net Amount' },
                          { key: 'vat_amount', label: 'VAT Amount' },
                          { key: 'gross_amount', label: 'Gross Amount' },
                          { key: 'currency', label: 'Currency' },
                          { key: 'invoice_date', label: 'Invoice Date' },
                          { key: 'due_date', label: 'Due Date' },
                          { key: 'performance_period_start', label: 'Period From' },
                          { key: 'performance_period_end', label: 'Period To' },
                        ].map((field) => {
                          const agreement = getAgreement(field.key);
                          let confidence = 0;
                          if (agreement.level === 'green') confidence = 90;
                          else if (agreement.level === 'yellow') confidence = 70;
                          else confidence = 50;

                          const modelNames: Record<string, string> = {
                            'deepseek': 'DeepSeek',
                            'mistral': 'Mistral',
                            'gemini': 'Gemini',
                            'claude': 'Claude',
                          };

                          return (
                            <div key={field.key} className="border rounded-lg p-3 bg-white">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-semibold text-sm text-gray-800">{field.label}</span>
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${
                                    agreement.level === 'green' ? 'bg-green-100 text-green-800' :
                                    agreement.level === 'yellow' ? 'bg-yellow-100 text-yellow-800' :
                                    'bg-red-100 text-red-800'
                                  }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${
                                      agreement.level === 'green' ? 'bg-green-500' :
                                      agreement.level === 'yellow' ? 'bg-yellow-500' : 'bg-red-500'
                                    }`} />
                                    {agreement.level === 'green' ? 'Match' : agreement.level === 'yellow' ? 'Partial' : 'Conflict'}
                                  </span>
                                  <span className={`text-xs font-semibold ${
                                    confidence >= 90 ? 'text-green-600' :
                                    confidence >= 70 ? 'text-yellow-600' : 'text-red-600'
                                  }`}>
                                    {confidence}%
                                  </span>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {Object.keys(invoice.raw_results).map((model) => {
                                  const modelResult = invoice.raw_results[model];
                                  const fieldKey = field.key as keyof InvoiceData;
                                  const value = modelResult ? modelResult[fieldKey] : null;
                                  const displayValue = value !== null && value !== undefined && value !== ''
                                    ? String(value)
                                    : '-';
                                  const isMatch = agreement.values.find(v => v.model === model)?.ok;
                                  return (
                                    <div key={model} className={`text-xs p-2 rounded ${
                                      isMatch ? 'bg-green-50' : 'bg-gray-50'
                                    }`}>
                                      <div className="font-medium text-gray-500 text-[10px] uppercase">{modelNames[model] || model}</div>
                                      <div className="text-gray-800 truncate" title={displayValue}>{displayValue}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Comparison Table - Desktop */}
                      <div className="hidden md:block border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-100 border-b">
                            <tr>
                              <th className="text-left p-3 font-semibold">Field</th>
                              {Object.keys(invoice.raw_results).map((model) => {
                                const modelNames: Record<string, string> = {
                                  'deepseek': 'DeepSeek',
                                  'mistral': 'Mistral',
                                  'gemini': 'Gemini',
                                  'claude': 'Claude',
                                };
                                return (
                                  <th key={model} className="text-left p-3 font-semibold">{modelNames[model] || model}</th>
                                );
                              })}
                              <th className="text-left p-3 font-semibold">Match</th>
                              <th className="text-right p-3 font-semibold">Confidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { key: 'vendor', label: 'Vendor' },
                              { key: 'account_number', label: 'Account Number' },
                              { key: 'document_type', label: 'Document Type' },
                              { key: 'net_amount', label: 'Net Amount' },
                              { key: 'vat_amount', label: 'VAT Amount' },
                              { key: 'gross_amount', label: 'Gross Amount' },
                              { key: 'currency', label: 'Currency' },
                              { key: 'invoice_date', label: 'Invoice Date' },
                              { key: 'due_date', label: 'Due Date' },
                              { key: 'performance_period_start', label: 'Performance Period From' },
                              { key: 'performance_period_end', label: 'Performance Period To' },
                            ].map((field) => {
                              const agreement = getAgreement(field.key);
                              let confidence = 0;
                              if (agreement.level === 'green') confidence = 90;
                              else if (agreement.level === 'yellow') confidence = 70;
                              else confidence = 50;

                              return (
                                <tr key={field.key} className="border-b hover:bg-gray-50">
                                  <td className="p-3 font-medium text-gray-700">{field.label}</td>
                                  {Object.keys(invoice.raw_results).map((model) => {
                                    const modelResult = invoice.raw_results[model];
                                    const fieldKey = field.key as keyof InvoiceData;
                                    const value = modelResult ? modelResult[fieldKey] : null;
                                    const displayValue = value !== null && value !== undefined && value !== ''
                                      ? String(value)
                                      : '-';
                                    return (
                                      <td key={model} className="p-3 text-gray-600 max-w-[150px] truncate" title={displayValue}>
                                        {displayValue}
                                      </td>
                                    );
                                  })}
                                  <td className="p-3">
                                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded ${
                                      agreement.level === 'green' ? 'bg-green-100 text-green-800' :
                                      agreement.level === 'yellow' ? 'bg-yellow-100 text-yellow-800' :
                                      'bg-red-100 text-red-800'
                                    }`}>
                                      <span className={`w-1.5 h-1.5 rounded-full ${
                                        agreement.level === 'green' ? 'bg-green-500' :
                                        agreement.level === 'yellow' ? 'bg-yellow-500' : 'bg-red-500'
                                      }`} />
                                      {agreement.level === 'green' ? 'Match' : agreement.level === 'yellow' ? 'Partial' : 'Conflict'}
                                    </span>
                                  </td>
                                  <td className="p-3 text-right font-semibold">
                                    <span className={
                                      confidence >= 90 ? 'text-green-600' :
                                      confidence >= 70 ? 'text-yellow-600' : 'text-red-600'
                                    }>
                                      {confidence}%
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Legend */}
                      <div className="flex items-center gap-4 text-xs text-gray-600 p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-green-500" />
                          <span>All models agree</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-yellow-500" />
                          <span>Partial agreement</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-red-500" />
                          <span>Models disagree</span>
                        </div>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
            </div>

            {/* Overall Confidence Bar */}
            <div className="mb-3">
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="text-gray-600 font-medium">Overall Confidence</span>
                <span className={`font-semibold ${
                  invoice.confidence_score >= 80 ? 'text-green-600' :
                  invoice.confidence_score >= 50 ? 'text-yellow-600' : 'text-red-600'
                }`}>{invoice.confidence_score.toFixed(0)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    invoice.confidence_score >= 80 ? 'bg-green-500' :
                    invoice.confidence_score >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${invoice.confidence_score}%` }}
                />
              </div>
            </div>

            {/* Confidence Summary Badges */}
            <div className="flex items-center gap-1.5 mb-3">
              {(() => {
                const low = invoice.review_needed?.filter((r: string) => r.includes('Low confidence')).length || 0;
                const medium = invoice.conflicts_data ? Object.keys(invoice.conflicts_data).length : 0;
                const total = Object.keys(invoice.consensus_data).length;
                const high = total - low - medium;
                return (
                  <>
                    {high > 0 && <span className="px-2 py-0.5 rounded text-[10px] bg-green-100 text-green-700 font-medium">{high} High</span>}
                    {medium > 0 && <span className="px-2 py-0.5 rounded text-[10px] bg-yellow-100 text-yellow-700 font-medium">{medium} Medium</span>}
                    {low > 0 && <span className="px-2 py-0.5 rounded text-[10px] bg-red-100 text-red-700 font-medium">{low} Low</span>}
                  </>
                );
              })()}
            </div>

            {/* Field Confidence Breakdown */}
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-600 hover:text-gray-800 font-medium mb-2">
                Field-by-field confidence →
              </summary>
              <div className="space-y-1.5 mt-2 max-h-48 overflow-y-auto">
                {(() => {
                  const fields = [
                    { key: 'vendor', label: 'Vendor' },
                    { key: 'account_number', label: 'Invoice Number' },
                    { key: 'document_type', label: 'Document Type' },
                    { key: 'net_amount', label: 'Net Amount' },
                    { key: 'vat_amount', label: 'VAT Amount' },
                    { key: 'gross_amount', label: 'Gross Amount' },
                    { key: 'currency', label: 'Currency' },
                    { key: 'invoice_date', label: 'Invoice Date' },
                    { key: 'due_date', label: 'Due Date' },
                    { key: 'performance_period_start', label: 'Performance Period From' },
                    { key: 'performance_period_end', label: 'Performance Period To' },
                  ];

                  // Calculate field confidence based on model agreement
                  return fields.map(field => {
                    const agreement = getAgreement(field.key);
                    let confidence = 0;
                    if (agreement.level === 'green') confidence = 90;
                    else if (agreement.level === 'yellow') confidence = 70;
                    else confidence = 50;

                    // Check if field has value
                    const value = invoice.consensus_data[field.key];
                    const hasValue = value !== null && value !== undefined && value !== '' && value !== '-';
                    if (!hasValue) confidence = Math.min(confidence, 49);

                    const isLow = confidence < 70;
                    const isMedium = confidence >= 70 && confidence < 90;

                    return (
                      <div key={field.key} className={`flex items-center justify-between py-1 px-2 rounded ${
                        isLow ? 'bg-red-50' : isMedium ? 'bg-yellow-50' : 'bg-green-50'
                      }`}>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            isLow ? 'bg-red-500' : isMedium ? 'bg-yellow-500' : 'bg-green-500'
                          }`} />
                          <span className="text-[11px] text-gray-700">{field.label}</span>
                        </div>
                        <span className={`text-[11px] font-semibold ${
                          isLow ? 'text-red-700' : isMedium ? 'text-yellow-700' : 'text-green-700'
                        }`}>
                          {confidence}%
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
              <div className="mt-3 pt-2 border-t border-gray-200 text-[10px] text-gray-500">
                AI confidence indicates how certain the system is about extracted values. Fields with lower confidence should be manually verified.
              </div>
            </details>
          </div>

          {/* Panel content */}
          <div className="p-4 space-y-4">
            {/* Vendor */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Vendor</label>
              <div className="flex items-center gap-2">
                <Input
                  defaultValue={(getAgreement('vendor').majority as string) || vendor}
                  className="h-9 text-sm flex-1"
                  placeholder="Enter vendor name"
                  onBlur={async (e) => {
                    const newValue = e.currentTarget.value;
                    if (newValue !== vendor) {
                      await saveFieldWithRetry('vendor', newValue);
                    }
                  }}
                />
                <AgreementDot field="vendor" />
              </div>
            </div>

            {/* Account Number (Customer Number) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Customer Nr.</label>
              <div className="flex items-center gap-2">
                <Input
                  defaultValue={(getAgreement('account_number').majority as string) || accountNr}
                  className="h-9 text-sm flex-1"
                  onBlur={async (e) => {
                    const newValue = e.currentTarget.value;
                    if (newValue !== accountNr) {
                      await saveFieldWithRetry('account_number', newValue);
                    }
                  }}
                />
                <AgreementDot field="account_number" />
              </div>
            </div>

            {/* Invoice Number */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Invoice Nr.</label>
              <div className="flex items-center gap-2">
                <Input
                  defaultValue={(getAgreement('invoice_number').majority as string) || invoiceNumber}
                  className="h-9 text-sm flex-1"
                  onBlur={async (e) => {
                    const newValue = e.currentTarget.value;
                    if (newValue !== invoiceNumber) {
                      await saveFieldWithRetry('invoice_number', newValue);
                    }
                  }}
                />
                <AgreementDot field="invoice_number" />
              </div>
            </div>

            {/* Document Type */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Document Type</label>
              <div className="flex items-center gap-2">
                <Input
                  defaultValue={(getAgreement('document_type').majority as string) || documentType}
                  className="h-9 text-sm flex-1"
                  placeholder="Enter document type"
                  onBlur={async (e) => {
                    const newValue = e.currentTarget.value;
                    if (newValue !== documentType) {
                      await saveFieldWithRetry('document_type', newValue);
                    }
                  }}
                />
                <AgreementDot field="document_type" />
              </div>
            </div>

            {/* Amounts Section */}
            <div className="space-y-3 pt-2 border-t">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">Net Amount</label>
                <div className="flex items-center gap-2">
                  <Input
                    defaultValue={getAgreement('net_amount').majority ? Number(getAgreement('net_amount').majority) : netAmount}
                    type="number"
                    step="0.01"
                    className="h-9 text-sm flex-1 text-right font-mono"
                    onBlur={async (e) => {
                      const v = parseFloat(e.currentTarget.value || '0');
                      if (v !== netAmount) await saveFieldWithRetry('net_amount', v);
                    }}
                  />
                  <AgreementDot field="net_amount" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">+ VAT Amount ({vatPercentage}%)</label>
                <div className="flex items-center gap-2">
                  <Input
                    defaultValue={getAgreement('vat_amount').majority ? Number(getAgreement('vat_amount').majority) : vatAmount}
                    type="number"
                    step="0.01"
                    className="h-9 text-sm flex-1 text-right font-mono"
                    onBlur={async (e) => {
                      const v = parseFloat(e.currentTarget.value || '0');
                      if (v !== vatAmount) await saveFieldWithRetry('vat_amount', v);
                    }}
                  />
                  <AgreementDot field="vat_amount" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Gross Invoice Amt.</label>
                <div className="flex items-center gap-2">
                  <Input
                    defaultValue={getAgreement('gross_amount').majority ? Number(getAgreement('gross_amount').majority) : grossAmount}
                    type="number"
                    step="0.01"
                    className="h-9 text-sm flex-1 text-right font-mono font-semibold"
                    onBlur={async (e) => {
                      const v = parseFloat(e.currentTarget.value || '0');
                      if (v !== grossAmount) await saveFieldWithRetry('gross_amount', v);
                    }}
                  />
                  <AgreementDot field="gross_amount" />
                </div>
              </div>
            </div>

            {/* Currency */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Currency</label>
              <div className="flex items-center gap-2">
                <Input
                  defaultValue={(getAgreement('currency').majority as string) || currency}
                  className="h-9 text-sm flex-1"
                  onBlur={async (e) => {
                    const v = e.currentTarget.value;
                    if (v !== currency) await saveFieldWithRetry('currency', v);
                  }}
                />
                <AgreementDot field="currency" />
              </div>
            </div>

            {/* Dates Section */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">Issued Date</label>
                <div className="flex items-center gap-1.5">
                  <Input
                    placeholder="DD/MM/YYYY"
                    defaultValue={formatDateForDisplay((getAgreement('invoice_date').majority as string) || issuedDate)}
                    className="h-9 text-sm flex-1"
                    onBlur={async (e) => {
                      const v = e.currentTarget.value;
                      const formatted = formatDateForDisplay(v);
                      if (formatted && formatted !== formatDateForDisplay(issuedDate)) {
                        await saveFieldWithRetry('invoice_date', formatted);
                      }
                    }}
                  />
                  <AgreementDot field="invoice_date" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">Due Date</label>
                <div className="flex items-center gap-1.5">
                  <Input
                    placeholder="DD/MM/YYYY"
                    defaultValue={formatDateForDisplay((getAgreement('due_date').majority as string) || dueDate)}
                    className="h-9 text-sm flex-1"
                    onBlur={async (e) => {
                      const v = e.currentTarget.value;
                      const formatted = formatDateForDisplay(v);
                      if (formatted && formatted !== formatDateForDisplay(dueDate)) {
                        await saveFieldWithRetry('due_date', formatted);
                      }
                    }}
                  />
                  <AgreementDot field="due_date" />
                </div>
              </div>
            </div>

            {/* Performance Period */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-gray-600">Performance Period</label>
                <AgreementDot field="performance_period_start" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="DD/MM/YYYY"
                  defaultValue={formatDateForDisplay(performancePeriodStart)}
                  className="h-9 text-sm"
                  onBlur={async (e) => {
                    const v = e.currentTarget.value;
                    const formatted = formatDateForDisplay(v);
                    if (formatted && formatted !== formatDateForDisplay(performancePeriodStart)) {
                      await saveFieldWithRetry('performance_period_start', formatted);
                    }
                  }}
                />
                <Input
                  placeholder="DD/MM/YYYY"
                  defaultValue={formatDateForDisplay(performancePeriodEnd)}
                  className="h-9 text-sm"
                  onBlur={async (e) => {
                    const v = e.currentTarget.value;
                    const formatted = formatDateForDisplay(v);
                    if (formatted && formatted !== formatDateForDisplay(performancePeriodEnd)) {
                      await saveFieldWithRetry('performance_period_end', formatted);
                    }
                  }}
                />
              </div>
            </div>

            {/* Assigned To */}
            <div className="space-y-1.5 pt-2 border-t">
              <label className="text-xs font-medium text-gray-600">Assigned To</label>
              <AssignmentDropdown
                entityType="invoice"
                currentAssignee={
                  invoice.assigned_agent_id
                    ? (() => {
                        const agent = getAgentById(invoice.assigned_agent_id);
                        return agent
                          ? { id: agent.id, firstName: agent.firstName, lastName: agent.lastName, email: agent.email }
                          : null;
                      })()
                    : null
                }
                onAssignmentChange={async (assignee) => {
                  try {
                    await invoicesApi.assign(Number(id), assignee?.id || null);
                    queryClient.setQueryData(['invoice', id], (prev: InvoiceExtractionRecord | undefined) =>
                      prev ? { ...prev, assigned_agent_id: assignee?.id || null } : prev
                    );
                  } catch (error) {
                    toast.error('Failed to assign invoice');
                    throw error;
                  }
                }}
              />
            </div>

            {/* Payment Date */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Payment Date</label>
              <Input
                placeholder="DD/MM/YYYY"
                defaultValue={invoice.payment_date ? formatDateForDisplay(invoice.payment_date) : ''}
                className="h-9 text-sm"
                onBlur={async (e) => {
                  const v = e.currentTarget.value;
                  const formatted = v ? formatDateForDisplay(v) : null;
                  try {
                    await invoicesApi.updatePayment(Number(id), { date: formatted });
                    queryClient.setQueryData(['invoice', id], (prev: InvoiceExtractionRecord | undefined) =>
                      prev ? { ...prev, payment_date: formatted } : prev
                    );
                    toast.success('Payment date updated');
                  } catch {
                    toast.error('Failed to update payment date');
                  }
                }}
              />
            </div>

            {/* Payment Method */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Payment Method</label>
              <Select
                value={invoice.payment_method || ''}
                onValueChange={async (value) => {
                  const method = value as InvoicePaymentMethod | null;
                  try {
                    await invoicesApi.updatePayment(Number(id), { method: method || null });
                    queryClient.setQueryData(['invoice', id], (prev: InvoiceExtractionRecord | undefined) =>
                      prev ? { ...prev, payment_method: method } : prev
                    );
                    toast.success('Payment method updated');
                  } catch {
                    toast.error('Failed to update payment method');
                  }
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  {INVOICE_PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Booking Date */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Booking Date</label>
              <Input
                placeholder="DD/MM/YYYY"
                defaultValue={formatDateForDisplay((getAgreement('booking_date').majority as string) || (invoice.consensus_data.booking_date as string) || '')}
                className="h-9 text-sm"
                onBlur={async (e) => {
                  const v = e.currentTarget.value;
                  const formatted = formatDateForDisplay(v);
                  if (formatted) await saveFieldWithRetry('booking_date', formatted);
                }}
              />
            </div>

            {/* Tags */}
            <div className="pt-2 border-t">
              <InvoiceTagsSection
                invoiceId={invoice.id}
                userEmail={userEmail}
              />
            </div>

            {/* Notes section - multi-note via threads */}
            <div className="pt-2">
              <InvoiceNotesSection
                invoiceId={String(invoice.id)}
                userId={getCurrentUserAgentId()}
                userName={userEmail}
              />
            </div>

            {/* Linked Invoices Section */}
            {linkedInvoices && (linkedInvoices.parent || linkedInvoices.children.length > 0) && (
              <div className="border-t pt-4 mt-2">
                <div className="flex items-center gap-1.5 mb-3">
                  <Link2 className="h-4 w-4 text-gray-500" />
                  <h3 className="text-sm font-semibold text-gray-700">Linked Invoices</h3>
                </div>
                <div className="space-y-2">
                  {/* Parent Invoice */}
                  {linkedInvoices.parent && (
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-2">
                      <div className="text-[10px] text-blue-600 font-medium uppercase mb-1">Parent Invoice</div>
                      <Link href={`/dashboard/invoices/${linkedInvoices.parent.id}`} className="group">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-sm font-medium text-gray-900 group-hover:text-blue-600">
                              {linkedInvoices.parent.invoice_number}
                            </span>
                            <span className="text-xs text-gray-500 ml-2">
                              {linkedInvoices.parent.vendor}
                            </span>
                          </div>
                          <ExternalLink className="h-3 w-3 text-gray-400 group-hover:text-blue-500" />
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {formatCurrency(linkedInvoices.parent.net_amount, linkedInvoices.parent.currency || detectedCurrency)}
                        </div>
                      </Link>
                    </div>
                  )}
                  {/* Child Invoices (credit notes, surcharges) */}
                  {linkedInvoices.children.map((child) => (
                    <div
                      key={child.id}
                      className={`border rounded-md p-2 ${
                        child.document_type === 'credit_note'
                          ? 'bg-orange-50 border-orange-200'
                          : child.document_type === 'surcharge_invoice'
                          ? 'bg-yellow-50 border-yellow-200'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className={`text-[10px] font-medium uppercase mb-1 ${
                        child.document_type === 'credit_note'
                          ? 'text-orange-600'
                          : child.document_type === 'surcharge_invoice'
                          ? 'text-yellow-700'
                          : 'text-gray-600'
                      }`}>
                        {child.document_type === 'credit_note'
                          ? 'Credit Note'
                          : child.document_type === 'surcharge_invoice'
                          ? 'Surcharge Invoice'
                          : child.document_type?.replace(/_/g, ' ')}
                      </div>
                      <Link href={`/dashboard/invoices/${child.id}`} className="group">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-sm font-medium text-gray-900 group-hover:text-blue-600">
                              {child.invoice_number}
                            </span>
                          </div>
                          <ExternalLink className="h-3 w-3 text-gray-400 group-hover:text-blue-500" />
                        </div>
                        <div className={`text-xs mt-1 ${
                          child.document_type === 'credit_note' ? 'text-orange-700' : 'text-gray-600'
                        }`}>
                          {formatCurrency(child.net_amount, child.currency || detectedCurrency)}
                        </div>
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status */}
            <div className="border-t pt-4 mt-2">
              <label className="text-xs font-medium text-gray-600 mb-2 block">Status</label>
              <div className="flex items-center gap-2">
                {invoice.payment_status === 'paid' ? (
                  <>
                    <span className="w-2.5 h-2.5 bg-blue-500 rounded-full" />
                    <span className="text-sm font-medium text-blue-700">Paid</span>
                  </>
                ) : invoice.status === 'approved' ? (
                  <>
                    <span className="w-2.5 h-2.5 bg-green-500 rounded-full" />
                    <span className="text-sm font-medium text-green-700">Approved</span>
                  </>
                ) : invoice.status === 'on_hold' ? (
                  <>
                    <span className="w-2.5 h-2.5 bg-orange-500 rounded-full" />
                    <span className="text-sm font-medium text-orange-700">On Hold</span>
                  </>
                ) : invoice.status === 'rejected' ? (
                  <>
                    <span className="w-2.5 h-2.5 bg-red-500 rounded-full" />
                    <span className="text-sm font-medium text-red-700">Deleted</span>
                  </>
                ) : (
                  <>
                    <span className="w-2.5 h-2.5 bg-yellow-500 rounded-full" />
                    <span className="text-sm font-medium text-yellow-700">Ready for approval</span>
                  </>
                )}
              </div>
              {/* Show approval info if approved or paid */}
              {(invoice.status === 'approved' || invoice.payment_status === 'paid') && invoice.approved_by && (
                <div className="text-xs text-gray-500 mt-2">
                  Approved by {(() => {
                    const approver = getAgentById(invoice.approved_by);
                    return approver ? `${approver.firstName} ${approver.lastName}` : `Agent #${invoice.approved_by}`;
                  })()}
                  {invoice.approved_at && (
                    <span> on {new Date(invoice.approved_at).toLocaleDateString('en-GB')}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sticky footer actions */}
          <div className="mt-auto sticky bottom-0 bg-white border-t px-4 py-3">
            {invoice.payment_status === 'paid' ? (
              /* PAID: Show payment done message */
              <div className="flex items-center justify-center gap-2 text-sm text-blue-700 bg-blue-50 rounded py-2">
                <span className="font-medium">Payment Done</span>
                {invoice.payment_date && <span>on {formatDateForDisplay(invoice.payment_date)}</span>}
              </div>
            ) : invoice.status === 'approved' ? (
              /* APPROVED: Mark as Paid, Undo Approval */
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 h-8 bg-blue-600 hover:bg-blue-700"
                  onClick={async () => {
                    try {
                      // Auto-set payment date to today if not manually set
                      const updateData: { payment_status: 'paid'; payment_date?: string } = { payment_status: 'paid' };
                      if (!invoice.payment_date) {
                        const today = new Date();
                        const formattedDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
                        updateData.payment_date = formattedDate;
                      }
                      await invoicesApi.update(Number(id), updateData);
                      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
                      queryClient.invalidateQueries({ queryKey: ['invoices'] });
                      toast.success('Invoice marked as paid');
                    } catch {
                      toast.error('Failed to update status');
                    }
                  }}
                >
                  Mark as Paid
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-gray-600 border-gray-300 hover:bg-gray-50"
                  onClick={async () => {
                    try {
                      await invoicesApi.update(Number(id), { status: 'pending' });
                      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
                      queryClient.invalidateQueries({ queryKey: ['invoices'] });
                      toast.success('Approval reverted');
                    } catch {
                      toast.error('Failed to update status');
                    }
                  }}
                >
                  Undo Approval
                </Button>
              </div>
            ) : invoice.status === 'on_hold' ? (
              /* ON HOLD: Approve, Delete */
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 h-8 bg-green-700 hover:bg-green-800"
                  onClick={async () => {
                    try {
                      const agentId = getCurrentUserAgentId();
                      await invoicesApi.update(Number(id), { status: 'approved', approved_by: agentId });
                      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
                      queryClient.invalidateQueries({ queryKey: ['invoices'] });
                      toast.success('Invoice approved');
                    } catch {
                      toast.error('Failed to approve invoice');
                    }
                  }}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-red-600 border-red-600 hover:bg-red-50"
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this invoice? This action cannot be undone.')) {
                      invoicesApi.update(Number(id), { status: 'rejected' })
                        .then(() => {
                          queryClient.invalidateQueries({ queryKey: ['invoices'] });
                          toast.success('Invoice deleted');
                          window.location.href = '/dashboard/invoices';
                        })
                        .catch(() => {
                          toast.error('Failed to delete invoice');
                        });
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            ) : invoice.status === 'rejected' ? (
              /* REJECTED/DELETED */
              <div className="flex justify-center items-center h-8 text-red-600 text-sm font-medium">
                This invoice has been deleted
              </div>
            ) : (
              /* PENDING: Approve, Put on Hold */
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 h-8 bg-green-700 hover:bg-green-800"
                  onClick={async () => {
                    try {
                      const agentId = getCurrentUserAgentId();
                      await invoicesApi.update(Number(id), { status: 'approved', approved_by: agentId });
                      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
                      queryClient.invalidateQueries({ queryKey: ['invoices'] });
                      toast.success('Invoice approved');
                    } catch {
                      toast.error('Failed to approve invoice');
                    }
                  }}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-orange-600 border-orange-600 hover:bg-orange-50"
                  onClick={async () => {
                    try {
                      await invoicesApi.update(Number(id), { status: 'on_hold' });
                      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
                      queryClient.invalidateQueries({ queryKey: ['invoices'] });
                      toast.success('Invoice put on hold');
                    } catch {
                      toast.error('Failed to update status');
                    }
                  }}
                >
                  Put On Hold
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

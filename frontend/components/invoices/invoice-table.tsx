'use client';

/**
 * Invoice Table Component
 * Displays list of invoices with sorting and filtering
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { InvoiceExtractionRecord } from '@shared/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, ChevronLeft, ChevronRight, User, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { agentsApi, type Agent } from '@/lib/api';
import { getInvoiceField } from '@/lib/invoice-field-compat';

interface InvoiceTableProps {
  invoices: InvoiceExtractionRecord[];
  isLoading?: boolean;
  pagination?: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  onPageChange?: (offset: number) => void;
  currentAgentId?: number | null;
}

export function InvoiceTable({
  invoices,
  isLoading,
  pagination,
  onPageChange,
  currentAgentId,
}: InvoiceTableProps) {
  const router = useRouter();
  const [sortConfig, setSortConfig] = useState<{
    key: keyof InvoiceExtractionRecord | null;
    direction: 'asc' | 'desc';
  }>({ key: null, direction: 'asc' });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Fetch agents for assignment display
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

  // Get agent by ID for display
  const getAgentById = (agentId: number | null): Agent | undefined => {
    if (!agentId) return undefined;
    return agents.find(agent => agent.id === agentId);
  };

  // Check if invoice is unread by current user
  const isUnread = (invoice: InvoiceExtractionRecord): boolean => {
    if (!currentAgentId) return false;
    const viewedBy = invoice.viewed_by || [];
    return !viewedBy.includes(currentAgentId);
  };

  // Copy invoice number to clipboard
  const handleCopyInvoiceNumber = async (e: React.MouseEvent, invoiceId: number, invoiceNumber: string) => {
    e.stopPropagation(); // Prevent row click navigation
    try {
      await navigator.clipboard.writeText(invoiceNumber);
      setCopiedId(invoiceId);
      toast.success('Invoice number copied');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleSort = (key: keyof InvoiceExtractionRecord) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortedInvoices = [...invoices].sort((a, b) => {
    if (!sortConfig.key) return 0;

    const aValue = a[sortConfig.key];
    const bValue = b[sortConfig.key];

    if (aValue === null || bValue === null) return 0;

    if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  // Helper to get value from either consensus_data or conflicts_data._final_value
  // Uses getInvoiceField for backward compatibility with old field names
  const getValue = (invoice: InvoiceExtractionRecord, field: string, defaultValue: string | number = '-'): string | number => {
    // Use compat helper to check both new and old field names
    const consensusValue = getInvoiceField<string | number | string[] | null>(invoice.consensus_data, field, null);
    if (consensusValue !== null && consensusValue !== undefined && consensusValue !== '' && consensusValue !== 0) {
      // Convert arrays to comma-separated strings for display
      if (Array.isArray(consensusValue)) {
        return consensusValue.join(', ');
      }
      return consensusValue as string | number;
    }
    // Fallback to conflicts_data._final_value if consensus is empty
    const conflictValue = getInvoiceField<Record<string, unknown> | null>(invoice.conflicts_data as Record<string, unknown>, field, null);
    if (conflictValue && typeof conflictValue === 'object' && '_final_value' in conflictValue) {
      const finalValue = conflictValue._final_value;
      if (finalValue !== null && finalValue !== undefined && finalValue !== '') {
        // Convert arrays to comma-separated strings for display
        if (Array.isArray(finalValue)) {
          return (finalValue as string[]).join(', ');
        }
        return finalValue as string | number;
      }
    }
    return defaultValue;
  };

  const getVendorName = (invoice: InvoiceExtractionRecord): string => {
    return getValue(invoice, 'vendor', '-') as string;
  };

  const getInvoiceNumber = (invoice: InvoiceExtractionRecord): string => {
    return getValue(invoice, 'invoice_number', '-') as string;
  };

  const getAmount = (invoice: InvoiceExtractionRecord): string => {
    // Get gross amount from invoice data
    const amount = getValue(invoice, 'gross_amount', 0) as number;
    const currencyCode = getValue(invoice, 'currency', 'EUR') as string;
    if (amount === 0 || amount === null || Number.isNaN(Number(amount))) return '-';
    const symbol = currencyCode === 'EUR' ? '€' : currencyCode === 'GBP' ? '£' : currencyCode === 'USD' ? '$' : `${currencyCode} `;
    return `${symbol}${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Month names for display
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Format date for display as "Mon DD, YYYY" (e.g., "Jan 05, 2026")
  const formatDateForTableDisplay = (dateStr: string): string => {
    if (!dateStr || dateStr === '-') return '-';

    let day: number, month: number, year: number;

    // If already in YYYY-MM-DD format (ISO)
    const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      year = parseInt(isoMatch[1]);
      month = parseInt(isoMatch[2]) - 1;
      day = parseInt(isoMatch[3]);
      return `${monthNames[month]} ${String(day).padStart(2, '0')}, ${year}`;
    }

    // If in DD.MM.YYYY format (European dots)
    const europeanDotMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (europeanDotMatch) {
      day = parseInt(europeanDotMatch[1]);
      month = parseInt(europeanDotMatch[2]) - 1;
      year = parseInt(europeanDotMatch[3]);
      return `${monthNames[month]} ${String(day).padStart(2, '0')}, ${year}`;
    }

    // If in DD/MM/YYYY format with slashes
    const slashMatch = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (slashMatch) {
      const first = parseInt(slashMatch[1]);
      const second = parseInt(slashMatch[2]);
      year = parseInt(slashMatch[3]);

      // If second > 12, it's MM/DD/YYYY (US format)
      if (second > 12) {
        month = first - 1;
        day = second;
      } else {
        // Assume European DD/MM/YYYY
        day = first;
        month = second - 1;
      }
      return `${monthNames[month]} ${String(day).padStart(2, '0')}, ${year}`;
    }

    // Return as-is if format not recognized
    return dateStr;
  };

  // Parse date string (DD/MM/YYYY or various formats) to Date object for comparison
  const parseDateForComparison = (dateStr: string): Date | null => {
    if (!dateStr || dateStr === '-') return null;

    // YYYY-MM-DD (ISO)
    const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    // DD.MM.YYYY (European dots)
    const europeanDotMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (europeanDotMatch) {
      const [, day, month, year] = europeanDotMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    // DD/MM/YYYY or MM/DD/YYYY (slashes)
    const slashMatch = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (slashMatch) {
      const [, first, second, year] = slashMatch;

      // If second > 12, it's MM/DD/YYYY
      if (parseInt(second, 10) > 12) {
        return new Date(parseInt(year), parseInt(first) - 1, parseInt(second));
      }

      // Otherwise assume European DD/MM/YYYY
      return new Date(parseInt(year), parseInt(second) - 1, parseInt(first));
    }

    return null;
  };

  const getIssuedDate = (invoice: InvoiceExtractionRecord): string => {
    // Get invoice date from invoice data
    const date = getValue(invoice, 'invoice_date', '-') as string;
    return formatDateForTableDisplay(date);
  };

  const getDueDateRaw = (invoice: InvoiceExtractionRecord): string => {
    return getValue(invoice, 'due_date', '-') as string;
  };

  const getDueDate = (invoice: InvoiceExtractionRecord): string => {
    const date = getDueDateRaw(invoice);
    return formatDateForTableDisplay(date);
  };

  // Get due date color class based on urgency
  // Red: past due, Yellow: within 7 days, Blue: more than 7 days away
  const getDueDateColorClass = (invoice: InvoiceExtractionRecord): string => {
    const rawDate = getDueDateRaw(invoice);
    const dueDate = parseDateForComparison(rawDate);
    if (!dueDate) return 'text-gray-600';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      // Past due - red
      return 'text-red-500 font-medium';
    } else if (diffDays <= 7) {
      // Due within 7 days - yellow/amber
      return 'text-amber-500 font-medium';
    } else {
      // More than 7 days away - blue
      return 'text-blue-500';
    }
  };

  // Get payment date (from direct column, not consensus_data)
  const getPaymentDate = (invoice: InvoiceExtractionRecord): string => {
    if (!invoice.payment_date) return '-';
    return formatDateForTableDisplay(invoice.payment_date);
  };

  // Get payment method (from direct column)
  const getPaymentMethod = (invoice: InvoiceExtractionRecord): string => {
    return invoice.payment_method || '-';
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 animate-pulse rounded" />
        ))}
      </div>
    );
  }

  if (!invoices || invoices.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No invoices found</p>
      </div>
    );
  }

  const currentPage = pagination ? Math.floor(pagination.offset / pagination.limit) + 1 : 1;
  const totalPages = pagination ? Math.ceil(pagination.total / pagination.limit) : 1;

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[160px]">
              <Button variant="ghost" onClick={() => handleSort('file_name')} className="h-8 px-2">
                Invoice Nr.
                <ArrowUpDown className="ml-2 h-3 w-3" />
              </Button>
            </TableHead>
            <TableHead>
              <Button variant="ghost" onClick={() => handleSort('consensus_data')} className="h-8 px-2">
                Vendor
                <ArrowUpDown className="ml-2 h-3 w-3" />
              </Button>
            </TableHead>
            <TableHead>Issued Date</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead className="text-right">Invoice Amount</TableHead>
            <TableHead>Discrepancy</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Assigned To</TableHead>
            <TableHead>Payment Date</TableHead>
            <TableHead>Payment Method</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedInvoices.map((invoice) => {
            const vendorName = getVendorName(invoice);
            const invoiceNumber = getInvoiceNumber(invoice);
            const amount = getAmount(invoice);
            const issuedDate = getIssuedDate(invoice);
            const dueDate = getDueDate(invoice);
            const paymentDate = getPaymentDate(invoice);
            const paymentMethod = getPaymentMethod(invoice);
            const assignedAgent = getAgentById(invoice.assigned_agent_id);
            const invoiceIsUnread = isUnread(invoice);

            // Placeholder discrepancy until wired
            const discrepancy = '-';

            return (
              <TableRow
                key={invoice.id}
                className={`cursor-pointer hover:bg-gray-50 ${invoiceIsUnread ? 'bg-blue-50/30' : ''}`}
                onClick={() => router.push(`/dashboard/invoices/${invoice.id}`)}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2 group/cell">
                    {invoiceIsUnread && (
                      <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                    )}
                    <span className={invoiceIsUnread ? 'font-semibold' : ''}>
                      {invoiceNumber !== '-' ? invoiceNumber : invoice.file_name.substring(0, 20)}
                    </span>
                    {invoiceNumber !== '-' && (
                      <button
                        onClick={(e) => handleCopyInvoiceNumber(e, invoice.id, invoiceNumber)}
                        className="opacity-0 group-hover/cell:opacity-100 transition-opacity p-1 hover:bg-gray-100 rounded"
                        title="Copy invoice number"
                      >
                        {copiedId === invoice.id ? (
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600" />
                        )}
                      </button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-medium">{vendorName}</TableCell>
                <TableCell className="text-sm text-gray-600">{issuedDate}</TableCell>
                <TableCell>
                  <span className={`text-sm ${getDueDateColorClass(invoice)}`}>
                    {dueDate || '-'}
                  </span>
                </TableCell>
                <TableCell className="text-right font-medium">{amount}</TableCell>
                <TableCell className="text-sm text-gray-600">{discrepancy}</TableCell>
                <TableCell>
                  {invoice.payment_status === 'paid' ? (
                    <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50">
                      <span className="w-2 h-2 bg-blue-600 rounded-full mr-2" />
                      Paid
                    </Badge>
                  ) : invoice.status === 'approved' ? (
                    <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                      <span className="w-2 h-2 bg-green-600 rounded-full mr-2" />
                      Approved
                    </Badge>
                  ) : invoice.status === 'on_hold' ? (
                    <Badge variant="outline" className="text-orange-600 border-orange-200 bg-orange-50">
                      <span className="w-2 h-2 bg-orange-600 rounded-full mr-2" />
                      On Hold
                    </Badge>
                  ) : invoice.status === 'rejected' ? (
                    <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">
                      <span className="w-2 h-2 bg-red-600 rounded-full mr-2" />
                      Deleted
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-yellow-600 border-yellow-200 bg-yellow-50">
                      <span className="w-2 h-2 bg-yellow-600 rounded-full mr-2" />
                      Pending
                    </Badge>
                  )}
                </TableCell>
                {/* Assigned To */}
                <TableCell>
                  {assignedAgent ? (
                    <div className="flex items-center gap-1.5">
                      <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center">
                        <User className="w-3 h-3 text-emerald-600" />
                      </div>
                      <span className="text-sm text-gray-700">
                        {assignedAgent.firstName} {assignedAgent.lastName?.charAt(0)}.
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">-</span>
                  )}
                </TableCell>
                {/* Payment Date */}
                <TableCell className="text-sm text-gray-600">{paymentDate}</TableCell>
                {/* Payment Method */}
                <TableCell className="text-sm text-gray-600">{paymentMethod}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Pagination */}
      {pagination && pagination.total > pagination.limit && (
        <div className="flex items-center justify-between px-2">
          <p className="text-sm text-gray-600">
            Showing {pagination.offset + 1}-{Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
          </p>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(Math.max(0, pagination.offset - pagination.limit))}
              disabled={pagination.offset === 0}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(pagination.offset + pagination.limit)}
              disabled={!pagination.hasMore}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

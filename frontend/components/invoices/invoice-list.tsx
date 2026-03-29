'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDistance } from 'date-fns';
import type { InvoiceExtractionRecord } from '@shared/types';
import { getInvoiceField } from '@/lib/invoice-field-compat';

interface InvoiceListProps {
  invoices: InvoiceExtractionRecord[];
  isLoading?: boolean;
  pagination?: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  onPageChange?: (offset: number) => void;
}

export function InvoiceList({ invoices, isLoading, pagination, onPageChange }: InvoiceListProps) {
  const router = useRouter();

  if (isLoading) {
    return (
      <div className="p-2 space-y-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-md" />
        ))}
      </div>
    );
  }

  if (!invoices || invoices.length === 0) {
    return <div className="text-center py-10 text-gray-500">No invoices found</div>;
  }

  const getConfidenceBadge = (score: number) => {
    if (score >= 80) return <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-green-100 text-green-800 border border-green-200">High ({score.toFixed(1)}%)</span>;
    if (score >= 50) return <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-yellow-100 text-yellow-800 border border-yellow-200">Medium ({score.toFixed(1)}%)</span>;
    return <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-red-100 text-red-800 border border-red-200">Low ({score.toFixed(1)}%)</span>;
  };

  // Use compat helpers for backward compatibility with old field names
  const getInvoiceNumberValue = (c: Record<string, unknown>) => getInvoiceField(c, 'invoice_number', '-');
  const getVendor = (c: Record<string, unknown>) => getInvoiceField(c, 'vendor', '-');
  const getIssuedDate = (c: Record<string, unknown>) => getInvoiceField(c, 'invoice_date', '-');
  const getDueDate = (c: Record<string, unknown>) => getInvoiceField(c, 'due_date', '-');
  const getAmount = (c: Record<string, unknown>) => {
    const amount = getInvoiceField<number>(c, 'gross_amount', 0);
    const currency = getInvoiceField(c, 'currency', 'EUR');
    if (!amount) return '-';
    return `${currency} ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const currentPage = pagination ? Math.floor(pagination.offset / pagination.limit) + 1 : 1;
  const totalPages = pagination ? Math.ceil(pagination.total / pagination.limit) : 1;

  return (
    <div className="space-y-2">
      {invoices.map((inv) => (
        <div
          key={inv.id}
          className="bg-white rounded-md p-3 border hover:border-[#2596be] hover:shadow-sm transition-all cursor-pointer"
          onClick={() => router.push(`/dashboard/invoices/${inv.id}`)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-[13px] font-medium leading-snug truncate">{getInvoiceNumberValue(inv.consensus_data)}</h4>
                <span className="text-[12px] text-gray-500 truncate">{getVendor(inv.consensus_data)}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-gray-600 flex-wrap">
                <span>Issued {getIssuedDate(inv.consensus_data)}</span>
                <span className="text-gray-300">•</span>
                <span>Due {getDueDate(inv.consensus_data)}</span>
                <span className="text-gray-300">•</span>
                <span>Uploaded {formatDistance(new Date(inv.created_at), new Date(), { addSuffix: true })}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="text-sm font-medium">{getAmount(inv.consensus_data)}</div>
              <div>{getConfidenceBadge(inv.confidence_score)}</div>
            </div>
          </div>
        </div>
      ))}

      {pagination && pagination.total > pagination.limit && (
        <div className="flex items-center justify-between px-1 pt-1">
          <p className="text-sm text-gray-600">
            Showing {pagination.offset + 1}-{Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onPageChange?.(Math.max(0, pagination.offset - pagination.limit))} disabled={pagination.offset === 0}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => onPageChange?.(pagination.offset + pagination.limit)} disabled={!pagination.hasMore}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}




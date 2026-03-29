'use client';

/**
 * Vendor Table Component
 * Displays list of vendors with expandable rows
 */

import { useState } from 'react';
import type { Vendor, PaymentTermsType } from '@shared/types';
import { PAYMENT_TERMS_LABELS } from '@shared/types';
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
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit,
  Trash2,
  ChevronsUpDown,
} from 'lucide-react';

interface VendorTableProps {
  vendors: Vendor[];
  isLoading?: boolean;
  pagination?: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  onPageChange?: (offset: number) => void;
  onEdit: (vendor: Vendor) => void;
  onDelete: (vendor: Vendor) => void;
}

/**
 * Format payment terms for display
 */
function formatPaymentTerms(type: PaymentTermsType, customDays: number | null): string {
  if (type === 'custom' && customDays) {
    return `${customDays} days`;
  }
  return PAYMENT_TERMS_LABELS[type] || '-';
}

export function VendorTable({
  vendors,
  isLoading,
  pagination,
  onPageChange,
  onEdit,
  onDelete,
}: VendorTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const toggleRow = (vendorId: number) => {
    setExpandedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(vendorId)) {
        newSet.delete(vendorId);
      } else {
        newSet.add(vendorId);
      }
      return newSet;
    });
  };

  const expandAll = () => {
    setExpandedRows(new Set(vendors.map((v) => v.id)));
  };

  const collapseAll = () => {
    setExpandedRows(new Set());
  };

  const toggleSort = () => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  const sortedVendors = [...vendors].sort((a, b) => {
    const comparison = a.name.localeCompare(b.name);
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (vendors.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No vendors found. Add your first vendor to get started.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-500">
          {vendors.length} vendor{vendors.length !== 1 ? 's' : ''}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={expandedRows.size === vendors.length ? collapseAll : expandAll}
          >
            <ChevronsUpDown className="h-4 w-4 mr-1" />
            {expandedRows.size === vendors.length ? 'Collapse All' : 'Expand All'}
          </Button>
          <Button variant="outline" size="sm" onClick={toggleSort}>
            <span className="mr-1">Name</span>
            <span className="text-xs">{sortDirection === 'asc' ? 'A-Z' : 'Z-A'}</span>
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]"></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Services</TableHead>
              <TableHead>Payment Terms</TableHead>
              <TableHead>VAT %</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedVendors.map((vendor) => (
              <>
                {/* Main row */}
                <TableRow
                  key={vendor.id}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => toggleRow(vendor.id)}
                >
                  <TableCell className="w-[30px]">
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-200 ${
                        expandedRows.has(vendor.id) ? 'rotate-180' : ''
                      }`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{vendor.name}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {vendor.services?.map((service) => (
                        <Badge key={service} variant="secondary" className="text-xs">
                          {service}
                        </Badge>
                      )) || '-'}
                    </div>
                  </TableCell>
                  <TableCell>
                    {formatPaymentTerms(vendor.payment_terms_type, vendor.payment_terms_custom_days)}
                  </TableCell>
                  <TableCell>{vendor.vat_info || '-'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(vendor);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(vendor);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>

                {/* Expanded details row */}
                {expandedRows.has(vendor.id) && (
                  <TableRow key={`${vendor.id}-details`} className="bg-gray-50">
                    <TableCell colSpan={6} className="py-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pl-8">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Source of invoice</div>
                          <div className="text-sm">{vendor.invoice_source || '-'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Shipment type</div>
                          <div className="text-sm">{vendor.shipment_type || '-'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Invoice frequency</div>
                          <div className="text-sm">{vendor.invoice_frequency || '-'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Invoice format</div>
                          <div className="text-sm">{vendor.invoice_format || '-'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Payment method</div>
                          <div className="text-sm">{vendor.payment_method || '-'}</div>
                        </div>
                        {vendor.notes && (
                          <div className="col-span-2 md:col-span-3">
                            <div className="text-xs text-gray-500 mb-1">Notes</div>
                            <div className="text-sm">{vendor.notes}</div>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pagination && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Showing {pagination.offset + 1}-
            {Math.min(pagination.offset + vendors.length, pagination.total)} of{' '}
            {pagination.total}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(pagination.offset - pagination.limit)}
              disabled={pagination.offset === 0}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
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

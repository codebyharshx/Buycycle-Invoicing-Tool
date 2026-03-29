'use client';

/**
 * Invoice Data Source Table Component
 * Displays list of email data sources for invoice ingestion
 */

import type { InvoiceDataSource } from '@shared/types';
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
  ChevronLeft,
  ChevronRight,
  Edit,
  Archive,
  Mail,
  Eye,
} from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface DataSourceTableProps {
  dataSources: InvoiceDataSource[];
  isLoading?: boolean;
  pagination?: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  onPageChange?: (offset: number) => void;
  onEdit: (dataSource: InvoiceDataSource) => void;
  onArchive: (dataSource: InvoiceDataSource) => void;
}

/**
 * Get badge variant based on status
 */
function getStatusBadge(status: InvoiceDataSource['status']) {
  switch (status) {
    case 'active':
      return <Badge className="bg-green-100 text-green-800">Active</Badge>;
    case 'paused':
      return <Badge className="bg-yellow-100 text-yellow-800">Paused</Badge>;
    case 'archived':
      return <Badge className="bg-gray-100 text-gray-600">Archived</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

/**
 * Format date for display
 */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  try {
    const date = new Date(dateStr);
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return dateStr;
  }
}

export function DataSourceTable({
  dataSources,
  isLoading,
  pagination,
  onPageChange,
  onEdit,
  onArchive,
}: DataSourceTableProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (dataSources.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Mail className="h-12 w-12 mx-auto mb-4 text-gray-300" />
        <p className="text-lg font-medium">No data sources found</p>
        <p className="text-sm mt-1">Create your first email data source to start receiving invoices.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="text-sm text-gray-500">
        {dataSources.length} data source{dataSources.length !== 1 ? 's' : ''}
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email Address</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Vendor Hint</TableHead>
              <TableHead className="text-center">Emails</TableHead>
              <TableHead className="text-center">Invoices</TableHead>
              <TableHead>Last Received</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dataSources.map((ds) => (
              <TableRow key={ds.id} className="hover:bg-gray-50">
                <TableCell className="font-medium">
                  <Link
                    href={`/dashboard/invoices/data-sources/${ds.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {ds.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <code className="text-sm bg-gray-100 px-2 py-0.5 rounded">
                    {ds.email_address}
                  </code>
                </TableCell>
                <TableCell>{getStatusBadge(ds.status)}</TableCell>
                <TableCell>
                  {ds.vendor_hint ? (
                    <Badge variant="outline">{ds.vendor_hint}</Badge>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {ds.total_emails_received.toLocaleString()}
                </TableCell>
                <TableCell className="text-center">
                  {ds.total_invoices_processed.toLocaleString()}
                </TableCell>
                <TableCell className="text-gray-500 text-sm">
                  {formatDate(ds.last_received_at)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Link href={`/dashboard/invoices/data-sources/${ds.id}`}>
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(ds)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    {ds.status !== 'archived' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onArchive(ds)}
                      >
                        <Archive className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pagination && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Showing {pagination.offset + 1}-
            {Math.min(pagination.offset + dataSources.length, pagination.total)} of{' '}
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

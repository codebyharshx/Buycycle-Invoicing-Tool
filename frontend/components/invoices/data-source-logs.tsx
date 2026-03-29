'use client';

/**
 * Data Source Logs Component
 * Displays activity logs for an invoice data source
 */

import type { InvoiceDataSourceLog } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ChevronLeft,
  ChevronRight,
  Mail,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  FileDown,
} from 'lucide-react';
import { format } from 'date-fns';
import Link from 'next/link';

interface DataSourceLogsProps {
  logs: InvoiceDataSourceLog[];
  isLoading?: boolean;
  pagination?: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  onPageChange?: (offset: number) => void;
}

/**
 * Get icon for event type
 */
function getEventIcon(eventType: InvoiceDataSourceLog['event_type']) {
  switch (eventType) {
    case 'email_received':
      return <Mail className="h-4 w-4 text-blue-500" />;
    case 'attachment_saved':
      return <FileDown className="h-4 w-4 text-purple-500" />;
    case 'processing_started':
      return <Clock className="h-4 w-4 text-yellow-500" />;
    case 'processing_completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'processing_failed':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'no_attachment':
      return <AlertCircle className="h-4 w-4 text-gray-400" />;
    default:
      return <FileText className="h-4 w-4 text-gray-400" />;
  }
}

/**
 * Get event type label
 */
function getEventLabel(eventType: InvoiceDataSourceLog['event_type']): string {
  switch (eventType) {
    case 'email_received':
      return 'Email Received';
    case 'attachment_saved':
      return 'Attachment Saved';
    case 'processing_started':
      return 'Processing Started';
    case 'processing_completed':
      return 'Processing Completed';
    case 'processing_failed':
      return 'Processing Failed';
    case 'no_attachment':
      return 'No Attachment';
    default:
      return eventType;
  }
}

/**
 * Get status badge
 */
function getStatusBadge(status: InvoiceDataSourceLog['status']) {
  switch (status) {
    case 'success':
      return <Badge className="bg-green-100 text-green-800">Success</Badge>;
    case 'failed':
      return <Badge className="bg-red-100 text-red-800">Failed</Badge>;
    case 'processing':
      return <Badge className="bg-yellow-100 text-yellow-800">Processing</Badge>;
    case 'received':
      return <Badge className="bg-blue-100 text-blue-800">Received</Badge>;
    case 'skipped':
      return <Badge className="bg-gray-100 text-gray-600">Skipped</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

/**
 * Format file size
 */
function formatFileSize(bytes: number | null): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DataSourceLogs({
  logs,
  isLoading,
  pagination,
  onPageChange,
}: DataSourceLogsProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Mail className="h-12 w-12 mx-auto mb-4 text-gray-300" />
        <p className="text-lg font-medium">No activity yet</p>
        <p className="text-sm mt-1">Logs will appear here when emails are received.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Log entries */}
      <div className="space-y-3">
        {logs.map((log) => (
          <div
            key={log.id}
            className="bg-white border rounded-lg p-4 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className="flex-shrink-0 mt-0.5">
                {getEventIcon(log.event_type)}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">
                    {getEventLabel(log.event_type)}
                  </span>
                  {getStatusBadge(log.status)}
                </div>

                {/* Email details */}
                {log.from_email && (
                  <p className="text-sm text-gray-600 truncate">
                    From: <span className="font-mono">{log.from_email}</span>
                  </p>
                )}
                {log.subject && (
                  <p className="text-sm text-gray-600 truncate">
                    Subject: {log.subject}
                  </p>
                )}

                {/* File details */}
                {log.file_name && (
                  <p className="text-sm text-gray-600 mt-1">
                    <span className="font-mono bg-gray-100 px-1 rounded">
                      {log.file_name}
                    </span>
                    {log.file_size && (
                      <span className="text-gray-400 ml-2">
                        ({formatFileSize(log.file_size)})
                      </span>
                    )}
                  </p>
                )}

                {/* Invoice link */}
                {log.invoice_extraction_id && (
                  <p className="text-sm mt-1">
                    <Link
                      href={`/dashboard/invoices/${log.invoice_extraction_id}`}
                      className="text-blue-600 hover:underline"
                    >
                      View Invoice #{log.invoice_extraction_id}
                    </Link>
                  </p>
                )}

                {/* Error message */}
                {log.error_message && (
                  <p className="text-sm text-red-600 mt-1 bg-red-50 p-2 rounded">
                    {log.error_message}
                  </p>
                )}

                {/* Timestamp */}
                <p className="text-xs text-gray-400 mt-2">
                  {format(new Date(log.received_at), 'MMM d, yyyy h:mm:ss a')}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {pagination && (
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-gray-500">
            Showing {pagination.offset + 1}-
            {Math.min(pagination.offset + logs.length, pagination.total)} of{' '}
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

'use client';

/**
 * Invoice Stats Cards
 * Display summary statistics for invoices
 */

import { Card, CardContent } from '@/components/ui/card';
import { FileText, Pause, AlertTriangle } from 'lucide-react';

interface InvoiceStatsCardsProps {
  openCount: number;
  onHoldCount: number;
  discrepanciesCount: number;
}

export function InvoiceStatsCards({
  openCount,
  onHoldCount,
  discrepanciesCount,
}: InvoiceStatsCardsProps) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-600">Open Invoices</p>
              <p className="text-2xl font-bold mt-1">{openCount}</p>
              <p className="text-xs text-gray-500 mt-1">All</p>
            </div>
            <div className="p-2.5 bg-blue-50 rounded-lg">
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-600">On Hold</p>
              <p className="text-2xl font-bold mt-1">{onHoldCount}</p>
              <p className="text-xs text-gray-500 mt-1">On hold</p>
            </div>
            <div className="p-2.5 bg-gray-50 rounded-lg">
              <Pause className="h-5 w-5 text-gray-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-600">Discrepancies</p>
              <p className="text-2xl font-bold mt-1">{discrepanciesCount}</p>
              <p className="text-xs text-gray-500 mt-1">Warning</p>
            </div>
            <div className="p-2.5 bg-orange-50 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

/**
 * Consolidated Monthly Accounting View
 * Pivot table of line-item invoices grouped by vendor, with monthly columns
 * derived from line items' booking_created_date.
 */

import { useState, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invoicesApi } from '@/lib/api';
import type { AccountingViewResponse, AccountingViewQuery } from '@shared/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Calendar, FileSpreadsheet, Loader2, Filter } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import { toast } from 'sonner';

export function AccountingView() {
  const currentYear = new Date().getFullYear();
  const [dateFrom, setDateFrom] = useState<string>(`${currentYear}-01-01`);
  const [dateTo, setDateTo] = useState<string>(new Date().toISOString().split('T')[0]);
  const [exporting, setExporting] = useState(false);
  const [vendorFilter, setVendorFilter] = useState<string>('');

  const query: AccountingViewQuery = {
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
    ...(vendorFilter && { vendor: vendorFilter }),
  };

  const { data, isLoading, error } = useQuery<AccountingViewResponse>({
    queryKey: ['invoice-accounting', dateFrom, dateTo, vendorFilter],
    queryFn: () => invoicesApi.accountingView(query),
  });

  // Get unique vendor names from unfiltered data for the dropdown
  const { data: allData } = useQuery<AccountingViewResponse>({
    queryKey: ['invoice-accounting-vendors', dateFrom, dateTo],
    queryFn: () => invoicesApi.accountingView({ ...(dateFrom && { dateFrom }), ...(dateTo && { dateTo }) }),
  });

  const vendorOptions = useMemo(() => {
    if (!allData) return [];
    return allData.vendors.map((v) => v.vendor).sort();
  }, [allData]);

  const handlePreset = (preset: 'ytd' | '3m' | '6m' | 'all') => {
    const now = new Date();
    switch (preset) {
      case 'ytd':
        setDateFrom(`${now.getFullYear()}-01-01`);
        setDateTo(now.toISOString().split('T')[0]);
        break;
      case '3m': {
        const start = new Date(now);
        start.setMonth(start.getMonth() - 3);
        start.setDate(1);
        setDateFrom(start.toISOString().split('T')[0]);
        setDateTo(now.toISOString().split('T')[0]);
        break;
      }
      case '6m': {
        const start = new Date(now);
        start.setMonth(start.getMonth() - 6);
        start.setDate(1);
        setDateFrom(start.toISOString().split('T')[0]);
        setDateTo(now.toISOString().split('T')[0]);
        break;
      }
      case 'all':
        setDateFrom('');
        setDateTo('');
        break;
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await invoicesApi.accountingExport(query);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `accounting_${dateFrom || 'all'}_${dateTo || 'all'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Excel file downloaded');
    } catch {
      toast.error('Failed to export accounting data');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="p-4">
      {/* Controls row */}
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={dateFrom === `${currentYear}-01-01` && dateTo === new Date().toISOString().split('T')[0] ? 'default' : 'outline'}
            size="sm"
            onClick={() => handlePreset('ytd')}
          >
            YTD
          </Button>
          <Button variant="outline" size="sm" onClick={() => handlePreset('3m')}>
            3 Months
          </Button>
          <Button variant="outline" size="sm" onClick={() => handlePreset('6m')}>
            6 Months
          </Button>
          <Button
            variant={!dateFrom && !dateTo ? 'default' : 'outline'}
            size="sm"
            onClick={() => handlePreset('all')}
          >
            All Time
          </Button>

          <div className="flex items-center gap-1.5 ml-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-gray-400 text-sm">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5 ml-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]"
            >
              <option value="">All Carriers</option>
              {vendorOptions.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        <Button onClick={handleExport} disabled={exporting || !data || data.vendors.length === 0}>
          {exporting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-4 w-4 mr-2" />
          )}
          Export Excel
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="h-40 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <div className="text-center text-red-600 py-8">
          <p className="font-medium">Failed to load accounting data</p>
          <p className="text-sm text-gray-500 mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      ) : data && data.vendors.length > 0 ? (
        <div className="overflow-x-auto border rounded-md">
          <Table>
            <TableHeader>
              {/* Row 1: Month group headers */}
              <TableRow className="bg-gray-50">
                <TableHead
                  className="sticky left-0 z-20 bg-gray-50 min-w-[140px] border-r"
                  rowSpan={2}
                >
                  Carrier
                </TableHead>
                <TableHead
                  className="sticky left-[140px] z-20 bg-gray-50 min-w-[160px] border-r"
                  rowSpan={2}
                >
                  Invoice Nr
                </TableHead>
                <TableHead
                  className="sticky left-[300px] z-20 bg-gray-50 min-w-[110px] border-r"
                  rowSpan={2}
                >
                  Invoice Date
                </TableHead>
                {data.columnKeys.map((key) => (
                  <TableHead
                    key={key}
                    colSpan={2}
                    className={`text-center border-l ${
                      key.endsWith('-total')
                        ? 'bg-yellow-50 font-semibold'
                        : key === 'unmapped'
                          ? 'bg-orange-50'
                          : 'bg-gray-50'
                    }`}
                  >
                    {data.columnLabels[key]}
                  </TableHead>
                ))}
              </TableRow>
              {/* Row 2: Sub-headers */}
              <TableRow className="bg-gray-50">
                {data.columnKeys.map((key) => (
                  <Fragment key={key}>
                    <TableHead
                      className={`text-center text-xs border-l ${
                        key.endsWith('-total')
                          ? 'bg-yellow-50'
                          : key === 'unmapped'
                            ? 'bg-orange-50'
                            : 'bg-gray-50'
                      }`}
                    >
                      Shipments
                    </TableHead>
                    <TableHead
                      className={`text-right text-xs ${
                        key.endsWith('-total')
                          ? 'bg-yellow-50'
                          : key === 'unmapped'
                            ? 'bg-orange-50'
                            : 'bg-gray-50'
                      }`}
                    >
                      Amount
                    </TableHead>
                  </Fragment>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.vendors.map((vendorGroup) => (
                <Fragment key={vendorGroup.vendor}>
                  {/* Invoice rows */}
                  {vendorGroup.invoices.map((inv, idx) => (
                    <TableRow
                      key={inv.invoiceId}
                      className="hover:bg-blue-50/50 cursor-pointer"
                      onClick={() => window.open(`/dashboard/invoices/${inv.invoiceId}`, '_blank')}
                    >
                      <TableCell className="sticky left-0 z-10 bg-white border-r font-medium group-hover:bg-blue-50/50">
                        {idx === 0 ? inv.vendor : ''}
                      </TableCell>
                      <TableCell className="sticky left-[140px] z-10 bg-white border-r text-sm text-blue-600 underline underline-offset-2">
                        {inv.invoiceNumber || '-'}
                      </TableCell>
                      <TableCell className="sticky left-[300px] z-10 bg-white border-r text-sm text-gray-600">
                        {inv.invoiceDate || '-'}
                      </TableCell>
                      {data.columnKeys.map((key) => {
                        const bucket = inv.months.find((m) => m.key === key);
                        return (
                          <Fragment key={key}>
                            <TableCell
                              className={`text-center text-sm border-l ${
                                key.endsWith('-total') ? 'bg-yellow-50/50 font-medium' : ''
                              }`}
                            >
                              {bucket && bucket.shipmentCount > 0
                                ? bucket.shipmentCount
                                : ''}
                            </TableCell>
                            <TableCell
                              className={`text-right text-sm ${
                                key.endsWith('-total') ? 'bg-yellow-50/50 font-medium' : ''
                              }`}
                            >
                              {bucket && bucket.netAmount !== 0
                                ? formatCurrency(bucket.netAmount, inv.currency)
                                : ''}
                            </TableCell>
                          </Fragment>
                        );
                      })}
                    </TableRow>
                  ))}
                  {/* Vendor subtotal row */}
                  <TableRow className="bg-gray-100 font-semibold border-t">
                    <TableCell
                      className="sticky left-0 z-10 bg-gray-100 border-r"
                      colSpan={3}
                    >
                      {vendorGroup.vendor} Total ({vendorGroup.totalShipmentCount} shipments,{' '}
                      {formatCurrency(vendorGroup.totalNetAmount, 'EUR')})
                    </TableCell>
                    {data.columnKeys.map((key) => {
                      const bucket = vendorGroup.monthTotals.find((m) => m.key === key);
                      return (
                        <Fragment key={key}>
                          <TableCell
                            className={`text-center border-l ${
                              key.endsWith('-total') ? 'bg-yellow-100/50' : ''
                            }`}
                          >
                            {bucket && bucket.shipmentCount > 0
                              ? bucket.shipmentCount
                              : ''}
                          </TableCell>
                          <TableCell
                            className={`text-right ${
                              key.endsWith('-total') ? 'bg-yellow-100/50' : ''
                            }`}
                          >
                            {bucket && bucket.netAmount !== 0
                              ? formatCurrency(bucket.netAmount, 'EUR')
                              : ''}
                          </TableCell>
                        </Fragment>
                      );
                    })}
                  </TableRow>
                </Fragment>
              ))}
              {/* Grand total row */}
              <TableRow className="bg-gray-200 font-bold border-t-2">
                <TableCell
                  className="sticky left-0 z-10 bg-gray-200 border-r"
                  colSpan={3}
                >
                  Grand Total ({data.grandTotalShipmentCount} shipments,{' '}
                  {formatCurrency(data.grandTotalNetAmount, 'EUR')})
                </TableCell>
                {data.columnKeys.map((key) => {
                  const bucket = data.grandTotals.find((m) => m.key === key);
                  return (
                    <Fragment key={key}>
                      <TableCell
                        className={`text-center border-l ${
                          key.endsWith('-total') ? 'bg-yellow-200/50' : ''
                        }`}
                      >
                        {bucket && bucket.shipmentCount > 0
                          ? bucket.shipmentCount
                          : ''}
                      </TableCell>
                      <TableCell
                        className={`text-right ${
                          key.endsWith('-total') ? 'bg-yellow-200/50' : ''
                        }`}
                      >
                        {bucket && bucket.netAmount !== 0
                          ? formatCurrency(bucket.netAmount, 'EUR')
                          : ''}
                      </TableCell>
                    </Fragment>
                  );
                })}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">No accounting data found</p>
          <p className="text-sm mt-1">
            No line-item invoices match the selected date range. Try expanding the date range or selecting &quot;All Time&quot;.
          </p>
        </div>
      )}
    </Card>
  );
}

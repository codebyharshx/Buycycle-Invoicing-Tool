'use client';

import { useMemo } from 'react';
import type { InvoiceDashboardResponse, InvoiceMonthlySummary } from '@shared/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, CheckCircle2, FileText, Pause } from 'lucide-react';
import { formatCurrency } from '@/lib/format';

interface InvoiceDashboardOverviewProps {
  data?: InvoiceDashboardResponse;
  isLoading?: boolean;
  error?: Error | null;
}

const formatAmount = (value: number): string => formatCurrency(value, 'EUR');

const getHeatmapColor = (value: number, maxValue: number): string => {
  if (value <= 0 || maxValue <= 0) return '#f8fafc';
  const ratio = Math.min(1, value / maxValue);
  const opacity = 0.18 + ratio * 0.55;
  return `rgba(37, 150, 190, ${opacity})`;
};

const monthLabel = (monthIso: string): string => {
  const date = new Date(`${monthIso}T00:00:00Z`);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const groupMonthly = (rows: InvoiceMonthlySummary[], vendors: string[]) => {
  const monthKeys = Array.from(new Set(rows.map((r) => r.month))).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const vendorOrder = [...vendors];
  for (const row of rows) {
    if (!vendorOrder.includes(row.vendor)) {
      vendorOrder.push(row.vendor);
    }
  }
  const grid = vendorOrder.map((vendor) => {
    const cells = monthKeys.map((month) => rows.find((r) => r.vendor === vendor && r.month === month));
    return { vendor, cells };
  });
  return { monthKeys, vendorOrder, grid };
};

export const InvoiceDashboardOverview = ({ data, isLoading, error }: InvoiceDashboardOverviewProps) => {
  const vendors = data?.vendors ?? [];

  const { monthKeys, grid, maxValue } = useMemo(() => {
    const vendorList = data?.vendors ?? [];
    const monthlyRows = data?.monthly ?? [];
    const { monthKeys: months, grid } = groupMonthly(
      monthlyRows,
      vendorList.map((v) => v.vendor)
    );
    const maxVal = monthlyRows.reduce((acc, row) => Math.max(acc, row.totalNet), 0);
    return { monthKeys: months, grid, maxValue: maxVal };
  }, [data]);

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-4 text-sm text-red-700">
          Failed to load invoice dashboard: {error.message}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-gray-800">Open Invoices</CardTitle>
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
            <p className="text-xs text-gray-500">All open invoices by vendor</p>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="h-32 animate-pulse rounded-md bg-gray-100" />
            ) : (
              <div className="space-y-3">
                <div className="flex items-end justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-3xl font-bold">{data?.stats.open.count ?? 0}</p>
                    <p className="text-xs text-gray-500">Total open invoices</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">Total Invoice Value (Open)</p>
                    <p className="text-lg font-semibold text-gray-800">
                      {formatAmount(data?.stats.open.totalNet ?? 0)}
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="space-y-2 max-h-64 overflow-auto">
                  {vendors.length === 0 ? (
                    <p className="text-sm text-gray-500">No vendors found.</p>
                  ) : (
                    vendors.map((vendor) => (
                      <div key={vendor.vendor} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-blue-50 text-blue-700 font-semibold flex items-center justify-center">
                            {vendor.vendor.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{vendor.vendor}</p>
                            <p className="text-xs text-gray-500">{vendor.invoiceCount} invoices</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-gray-800">{formatAmount(vendor.totalNet)}</p>
                          <p className="text-xs text-gray-500">Net total</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold text-gray-800">Invoice Discrepancies</CardTitle>
                <AlertTriangle className="h-5 w-5 text-orange-600" />
              </div>
              <p className="text-xs text-gray-500">Invoices with missing or conflicting data</p>
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? (
                <div className="h-16 animate-pulse rounded-md bg-gray-100" />
              ) : (
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-bold text-gray-800">{data?.stats.discrepancies.count ?? 0}</p>
                    <p className="text-xs text-gray-500">Invoices with discrepancies</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Total Disputed Value</p>
                    <p className="text-lg font-semibold text-gray-800">
                      {formatAmount(data?.stats.discrepancies.totalNet ?? 0)}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold text-gray-800">Invoices on Hold</CardTitle>
                <Pause className="h-5 w-5 text-gray-600" />
              </div>
              <p className="text-xs text-gray-500">Requires follow-up</p>
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? (
                <div className="h-16 animate-pulse rounded-md bg-gray-100" />
              ) : (
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-bold text-gray-800">{data?.stats.onHold.count ?? 0}</p>
                    <p className="text-xs text-gray-500">Total invoices on hold</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Total Value</p>
                    <p className="text-lg font-semibold text-gray-800">
                      {formatAmount(data?.stats.onHold.totalNet ?? 0)}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold text-gray-800">Ready for Payment</CardTitle>
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <p className="text-xs text-gray-500">Approved invoices ready to pay</p>
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? (
                <div className="h-16 animate-pulse rounded-md bg-gray-100" />
              ) : (
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-bold text-gray-800">{data?.stats.readyForPayment.count ?? 0}</p>
                    <p className="text-xs text-gray-500">Invoices ready for payment</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Total Value</p>
                    <p className="text-lg font-semibold text-gray-800">
                      {formatAmount(data?.stats.readyForPayment.totalNet ?? 0)}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-gray-800">Invoices by Carrier Timeline</CardTitle>
              <p className="text-xs text-gray-500">Sum excludes credit notes and correction invoices</p>
            </div>
            {data?.lastUpdated ? (
              <p className="text-xs text-gray-500">Last updated: {new Date(data.lastUpdated).toLocaleString()}</p>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="h-72 animate-pulse rounded-md bg-gray-100" />
          ) : monthKeys.length === 0 ? (
            <p className="text-sm text-gray-500">No timeline data available.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-white text-left font-medium text-gray-600 w-32">Vendor</th>
                    {monthKeys.map((month) => (
                      <th key={month} className="text-center font-medium text-gray-600 px-2 py-2 min-w-[110px]">
                        {monthLabel(month)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.map(({ vendor, cells }) => (
                    <tr key={vendor} className="border-t">
                      <td className="sticky left-0 bg-white font-medium text-gray-800 py-2 pr-4">{vendor}</td>
                      {cells.map((cell, idx) => {
                        const value = cell?.totalNet ?? 0;
                        const count = cell?.invoiceCount ?? 0;
                        return (
                          <td key={`${vendor}-${monthKeys[idx]}`} className="px-2 py-2">
                            <div
                              className="rounded-md border text-center px-2 py-2"
                              style={{ backgroundColor: getHeatmapColor(value, maxValue), borderColor: '#e5e7eb' }}
                            >
                              <div className="text-xs text-gray-600">{count || '-'}</div>
                              <div className="text-sm font-semibold text-gray-800">{value ? formatAmount(value) : '€0.00'}</div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};


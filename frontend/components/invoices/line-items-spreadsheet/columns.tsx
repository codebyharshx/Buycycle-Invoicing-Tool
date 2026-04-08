'use client';

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import type { InvoiceLineItem } from '@shared/types';
import { formatCurrency } from '@/lib/format';

const columnHelper = createColumnHelper<InvoiceLineItem>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getColumns(currency: string, showExtraCharges: boolean): ColumnDef<InvoiceLineItem, any>[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseColumns: ColumnDef<InvoiceLineItem, any>[] = [
    // Row number (frozen, not resizable)
    columnHelper.display({
      id: 'rowNumber',
      header: '#',
      cell: ({ row }) => row.index + 1,
      size: 45,
      minSize: 45,
      maxSize: 45,
      enableResizing: false,
      meta: { frozen: true, className: 'bg-gray-100 text-gray-600 text-center' },
    }),
    // Shipment Number (frozen)
    columnHelper.accessor('shipment_number', {
      id: 'shipment_number',
      header: 'Shipment #',
      cell: ({ getValue }) => getValue() || '-',
      size: 130,
      minSize: 100,
      meta: { frozen: true, frozenOffset: 45, className: 'font-mono text-blue-600' },
    }),
    // Reference
    columnHelper.accessor('shipment_reference_1', {
      id: 'shipment_reference_1',
      header: 'Reference',
      cell: ({ getValue }) => getValue() || '-',
      size: 100,
      minSize: 80,
      meta: { className: 'font-mono text-gray-600' },
    }),
    // Shipment Date
    columnHelper.accessor('shipment_date', {
      id: 'shipment_date',
      header: 'Ship Date',
      cell: ({ getValue }) => {
        const val = getValue();
        if (!val) return '-';
        return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      },
      size: 95,
      minSize: 85,
    }),
    // Product Name
    columnHelper.accessor('product_name', {
      id: 'product_name',
      header: 'Product',
      cell: ({ getValue }) => getValue() || '-',
      size: 120,
      minSize: 80,
    }),
    // Origin City
    columnHelper.accessor('origin_city', {
      id: 'origin_city',
      header: 'From City',
      cell: ({ getValue }) => getValue() || '-',
      size: 100,
      minSize: 70,
    }),
    // Origin Postal Code
    columnHelper.accessor('origin_postal_code', {
      id: 'origin_postal_code',
      header: 'From PC',
      cell: ({ getValue }) => getValue() || '-',
      size: 70,
      minSize: 60,
      meta: { className: 'font-mono text-gray-500' },
    }),
    // Destination City
    columnHelper.accessor('destination_city', {
      id: 'destination_city',
      header: 'To City',
      cell: ({ getValue }) => getValue() || '-',
      size: 100,
      minSize: 70,
    }),
    // Destination Postal Code
    columnHelper.accessor('destination_postal_code', {
      id: 'destination_postal_code',
      header: 'To PC',
      cell: ({ getValue }) => getValue() || '-',
      size: 70,
      minSize: 60,
      meta: { className: 'font-mono text-gray-500' },
    }),
    // Weight
    columnHelper.accessor('weight_kg', {
      id: 'weight_kg',
      header: 'Weight',
      cell: ({ getValue }) => {
        const val = getValue();
        return val ? `${Number(val).toFixed(1)} kg` : '-';
      },
      size: 75,
      minSize: 65,
      meta: { className: 'text-right font-mono' },
    }),
    // Weight Flag
    columnHelper.accessor('weight_flag', {
      id: 'weight_flag',
      header: 'Flag',
      cell: ({ getValue }) => getValue() || '-',
      size: 45,
      minSize: 40,
      meta: { className: 'text-center font-mono text-gray-500' },
    }),
    // Pieces
    columnHelper.accessor('pieces', {
      id: 'pieces',
      header: 'Pcs',
      cell: ({ getValue }) => getValue() || '-',
      size: 45,
      minSize: 40,
      meta: { className: 'text-right' },
    }),
    // Base Price
    columnHelper.accessor('base_price', {
      id: 'base_price',
      header: 'Base',
      cell: ({ getValue }) => {
        const val = getValue();
        return val ? formatCurrency(Number(val), currency) : '-';
      },
      size: 85,
      minSize: 75,
      meta: { className: 'text-right font-mono' },
    }),
    // Total Surcharges
    columnHelper.accessor('total_surcharges', {
      id: 'total_surcharges',
      header: 'XC Total',
      cell: ({ getValue }) => {
        const val = getValue();
        return val ? formatCurrency(Number(val), currency) : '-';
      },
      size: 85,
      minSize: 75,
      meta: { className: 'text-right font-mono' },
    }),
    // Net Amount
    columnHelper.accessor('net_amount', {
      id: 'net_amount',
      header: 'Net',
      cell: ({ getValue }) => {
        const val = getValue();
        return val ? formatCurrency(Number(val), currency) : '-';
      },
      size: 90,
      minSize: 80,
      meta: { className: 'text-right font-mono font-semibold' },
    }),
    // Tax
    columnHelper.accessor('total_tax', {
      id: 'total_tax',
      header: 'Tax',
      cell: ({ getValue }) => {
        const val = getValue();
        return val ? formatCurrency(Number(val), currency) : '-';
      },
      size: 80,
      minSize: 70,
      meta: { className: 'text-right font-mono text-gray-500' },
    }),
    // Gross Amount
    columnHelper.accessor('gross_amount', {
      id: 'gross_amount',
      header: 'Gross',
      cell: ({ getValue }) => {
        const val = getValue();
        return val ? formatCurrency(Number(val), currency) : '-';
      },
      size: 95,
      minSize: 85,
      meta: { className: 'text-right font-mono font-semibold text-green-700' },
    }),
  ];

  // Add XC columns if enabled
  // Note: XC data may be in vendor_raw_data JSONB or direct fields
  if (showExtraCharges) {
    for (let i = 1; i <= 9; i++) {
      baseColumns.push(
        columnHelper.display({
          id: `xc${i}_name`,
          header: `XC${i}`,
          cell: ({ row }) => {
            const item = row.original;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rawData = (item as any).vendor_raw_data || {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const directVal = (item as any)[`xc${i}_name`];
            const val = rawData[`xc${i}_name`] || directVal;
            return val || '-';
          },
          size: 100,
          minSize: 70,
          meta: { className: 'text-gray-600 bg-blue-50/30' },
        }),
        columnHelper.display({
          id: `xc${i}_charge`,
          header: `XC${i} $`,
          cell: ({ row }) => {
            const item = row.original;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rawData = (item as any).vendor_raw_data || {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const directVal = (item as any)[`xc${i}_charge`];
            const val = rawData[`xc${i}_charge`] ?? directVal;
            return val ? formatCurrency(Number(val), currency) : '-';
          },
          size: 80,
          minSize: 65,
          meta: { className: 'text-right font-mono bg-blue-50/30' },
        })
      );
    }
  }

  return baseColumns;
}

// Column meta type extension
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    frozen?: boolean;
    frozenOffset?: number;
    className?: string;
  }
}

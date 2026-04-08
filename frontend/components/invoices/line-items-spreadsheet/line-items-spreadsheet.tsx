'use client';

import { useMemo, useRef, useState, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type ColumnResizeMode,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronUp, ChevronDown, ChevronsUpDown, Columns3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { InvoiceLineItem } from '@shared/types';
import { formatCurrency } from '@/lib/format';
import { getColumns } from './columns';

interface LineItemsSpreadsheetProps {
  lineItems: InvoiceLineItem[];
  currency: string;
  className?: string;
}

export function LineItemsSpreadsheet({
  lineItems,
  currency,
  className,
}: LineItemsSpreadsheetProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [showExtraCharges, setShowExtraCharges] = useState(true);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [columnResizeMode] = useState<ColumnResizeMode>('onChange');
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const columns = useMemo(
    () => getColumns(currency, showExtraCharges),
    [currency, showExtraCharges]
  );

  const table = useReactTable({
    data: lineItems,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode,
    enableColumnResizing: true,
  });

  const { rows } = table.getRowModel();

  // Virtualization
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 28, // Row height
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  // Calculate totals
  const totals = useMemo(() => {
    return {
      net: lineItems.reduce((sum, item) => sum + Number(item.net_amount || 0), 0),
      tax: lineItems.reduce((sum, item) => sum + Number(item.total_tax || 0), 0),
      gross: lineItems.reduce((sum, item) => sum + Number(item.gross_amount || 0), 0),
      base: lineItems.reduce((sum, item) => sum + Number(item.base_price || 0), 0),
      surcharges: lineItems.reduce((sum, item) => sum + Number(item.total_surcharges || 0), 0),
    };
  }, [lineItems]);

  // Frozen column offset calculations - now dynamic based on actual column sizes
  const getColumnWidth = useCallback((columnId: string) => {
    const column = table.getColumn(columnId);
    return column?.getSize() ?? 0;
  }, [table]);

  const getFrozenStyles = useCallback((columnId: string) => {
    if (columnId === 'rowNumber') {
      return { left: 0, zIndex: 20 };
    }
    if (columnId === 'shipment_number') {
      return { left: getColumnWidth('rowNumber'), zIndex: 20 };
    }
    return {};
  }, [getColumnWidth]);

  const isFrozenColumn = (columnId: string) => {
    return columnId === 'rowNumber' || columnId === 'shipment_number';
  };

  // Row click handler
  const handleRowClick = (rowId: string) => {
    setSelectedRowId(prev => prev === rowId ? null : rowId);
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-white border-b">
        <div className="text-xs text-gray-600">
          <span className="font-semibold">{lineItems.length}</span> shipments
          {selectedRowId && (
            <span className="ml-2 text-blue-600">
              (Row {rows.findIndex(r => r.id === selectedRowId) + 1} selected)
            </span>
          )}
        </div>
        <Button
          variant={showExtraCharges ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowExtraCharges(!showExtraCharges)}
          className="h-7 text-xs"
        >
          <Columns3 className="h-3.5 w-3.5 mr-1.5" />
          {showExtraCharges ? 'Hide' : 'Show'} Extra Charges (XC1-XC9)
        </Button>
      </div>

      {/* Spreadsheet Container */}
      <div
        ref={tableContainerRef}
        className="flex-1 overflow-auto bg-white"
        style={{ contain: 'strict' }}
      >
        <table
          className="border-collapse"
          style={{ width: table.getTotalSize(), minWidth: '100%' }}
        >
          {/* Header */}
          <thead className="sticky top-0 z-30 bg-gray-100">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isFrozen = isFrozenColumn(header.column.id);
                  const frozenStyles = getFrozenStyles(header.column.id);
                  const canSort = header.column.getCanSort();
                  const sortDirection = header.column.getIsSorted();

                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'px-2 py-1.5 text-[10px] font-semibold text-gray-700 border border-gray-300 bg-gray-100 whitespace-nowrap select-none relative group',
                        isFrozen && 'sticky bg-gray-100',
                        canSort && 'cursor-pointer hover:bg-gray-200'
                      )}
                      style={{
                        width: header.getSize(),
                        minWidth: header.column.columnDef.minSize,
                        ...frozenStyles,
                      }}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                        {canSort && (
                          <span className="flex-shrink-0">
                            {sortDirection === 'asc' ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : sortDirection === 'desc' ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronsUpDown className="h-3 w-3 text-gray-400" />
                            )}
                          </span>
                        )}
                      </div>
                      {/* Column Resize Handle */}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onClick={(e) => e.stopPropagation()}
                          className={cn(
                            'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none',
                            'hover:bg-blue-500 group-hover:bg-blue-300',
                            header.column.getIsResizing() && 'bg-blue-600'
                          )}
                          style={{ transform: 'translateX(50%)' }}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          {/* Body with virtualization */}
          <tbody
            style={{
              height: `${totalSize}px`,
              position: 'relative',
            }}
          >
            {/* Spacer for virtual scroll */}
            {virtualRows.length > 0 && virtualRows[0].start > 0 && (
              <tr style={{ height: `${virtualRows[0].start}px` }}>
                <td colSpan={columns.length} />
              </tr>
            )}

            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              const isSelected = row.id === selectedRowId;

              return (
                <tr
                  key={row.id}
                  onClick={() => handleRowClick(row.id)}
                  className={cn(
                    'cursor-pointer transition-colors',
                    isSelected
                      ? 'bg-blue-100 hover:bg-blue-150'
                      : 'hover:bg-blue-50/50'
                  )}
                  style={{ height: `${virtualRow.size}px` }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const isFrozen = isFrozenColumn(cell.column.id);
                    const frozenStyles = getFrozenStyles(cell.column.id);
                    const meta = cell.column.columnDef.meta as { className?: string } | undefined;

                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'px-2 py-0.5 text-[10px] border border-gray-200 whitespace-nowrap overflow-hidden text-ellipsis',
                          isFrozen && 'sticky',
                          isSelected
                            ? (isFrozen ? 'bg-blue-100' : 'bg-blue-100')
                            : (isFrozen ? 'bg-white' : ''),
                          meta?.className
                        )}
                        style={{
                          width: cell.column.getSize(),
                          minWidth: cell.column.columnDef.minSize,
                          maxWidth: cell.column.getSize(),
                          ...frozenStyles,
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Bottom spacer for virtual scroll */}
            {virtualRows.length > 0 && (
              <tr
                style={{
                  height: `${totalSize - (virtualRows[virtualRows.length - 1]?.end || 0)}px`,
                }}
              >
                <td colSpan={columns.length} />
              </tr>
            )}
          </tbody>

          {/* Footer with totals */}
          <tfoot className="sticky bottom-0 z-30 bg-gray-100">
            <tr>
              {table.getHeaderGroups()[0].headers.map((header) => {
                const isFrozen = isFrozenColumn(header.column.id);
                const frozenStyles = getFrozenStyles(header.column.id);
                const colId = header.column.id;

                let content: React.ReactNode = '';
                if (colId === 'rowNumber') {
                  content = '';
                } else if (colId === 'shipment_number') {
                  content = <span className="font-semibold">TOTAL</span>;
                } else if (colId === 'base_price') {
                  content = formatCurrency(totals.base, currency);
                } else if (colId === 'total_surcharges') {
                  content = formatCurrency(totals.surcharges, currency);
                } else if (colId === 'net_amount') {
                  content = <span className="font-semibold">{formatCurrency(totals.net, currency)}</span>;
                } else if (colId === 'total_tax') {
                  content = formatCurrency(totals.tax, currency);
                } else if (colId === 'gross_amount') {
                  content = <span className="font-semibold text-green-700">{formatCurrency(totals.gross, currency)}</span>;
                }

                return (
                  <td
                    key={header.id}
                    className={cn(
                      'px-2 py-1.5 text-[10px] font-mono border border-gray-300 bg-gray-100 whitespace-nowrap',
                      isFrozen && 'sticky bg-gray-100',
                      ['base_price', 'total_surcharges', 'net_amount', 'total_tax', 'gross_amount'].includes(colId) && 'text-right'
                    )}
                    style={{
                      width: header.getSize(),
                      minWidth: header.column.columnDef.minSize,
                      ...frozenStyles,
                    }}
                  >
                    {content}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

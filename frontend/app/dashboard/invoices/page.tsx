'use client';

/**
 * Invoices Dashboard Page
 * Lists all invoice extractions with OCR results
 */

import { Suspense, useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { invoicesApi, agentsApi, type Agent, type InvoiceViewFilter } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { InvoiceUploadDialog } from '@/components/invoices/invoice-upload-dialog';
import { InvoiceTable } from '@/components/invoices/invoice-table';
import { InvoiceStatsCards } from '@/components/invoices/invoice-stats-cards';
import { InvoiceExportDialog } from '@/components/invoices/invoice-export-dialog';
import { InvoiceFilterDialog, defaultFilters, type InvoiceFilters } from '@/components/invoices/invoice-filter-dialog';
import { usePageHeader } from '@/components/providers';
import { InvoiceDashboardOverview } from '@/components/invoices/invoice-dashboard-overview';
import { Search, Upload, List, BarChart3, Calendar, ChevronDown, Download, Filter, Check, Eye, Loader2, Building, FileSpreadsheet } from 'lucide-react';
import { AccountingView } from '@/components/invoices/accounting-view';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { InvoiceDashboardResponse, InvoiceExtractionRecord } from '@shared/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatInvoiceDateForTable, isInvoiceDueDateUrgent } from '@/lib/format';

/**
 * Helper function to get value from either consensus_data or conflicts_data._final_value
 */
function getInvoiceValue(invoice: InvoiceExtractionRecord, field: string, defaultValue: string | number = '-'): string | number {
  const consensusValue = invoice.consensus_data[field];
  if (consensusValue !== null && consensusValue !== undefined && consensusValue !== '' && consensusValue !== 0) {
    // Convert arrays to comma-separated strings for display
    if (Array.isArray(consensusValue)) {
      return consensusValue.join(', ');
    }
    return consensusValue;
  }
  // Fallback to conflicts_data._final_value if consensus is empty
  const conflict = invoice.conflicts_data?.[field];
  if (conflict && typeof conflict === 'object' && '_final_value' in conflict) {
    const finalValue = conflict._final_value;
    if (finalValue !== null && finalValue !== undefined && finalValue !== '') {
      // Convert arrays to comma-separated strings for display
      if (Array.isArray(finalValue)) {
        return finalValue.join(', ');
      }
      return finalValue;
    }
  }
  return defaultValue;
}

// Date formatting is now handled by formatInvoiceDate from @/lib/format

function InvoicesPageContent() {
  const { setHeader } = usePageHeader();
  const router = useRouter();
  const searchParams = useSearchParams();
  // User email - can be set from a config or left as undefined for now
  const userEmail: string | undefined = undefined;

  // Agent lookup for current user
  const [currentAgentId, setCurrentAgentId] = useState<number | null>(null);
  useEffect(() => {
    const fetchAgent = async () => {
      if (!userEmail) return;
      try {
        const result = await agentsApi.list();
        const agent = result.data.find((a: Agent) => a.email === userEmail);
        if (agent) setCurrentAgentId(agent.id);
      } catch (error) {
        console.error('Failed to fetch agents:', error);
      }
    };
    void fetchAgent();
  }, [userEmail]);

  // Initialize state from URL params
  const [page, setPage] = useState(() => {
    const p = searchParams?.get('page');
    return p ? parseInt(p, 10) : 1;
  });
  const [limit] = useState(20);
  const [searchTerm, setSearchTerm] = useState(() => searchParams?.get('search') || '');
  const [view, setView] = useState<'list' | 'vendor' | 'monthly' | 'accounting'>(() => {
    const v = searchParams?.get('view');
    return (v === 'vendor' || v === 'monthly' || v === 'accounting') ? v : 'list';
  });
  const [statusView, setStatusView] = useState<InvoiceViewFilter>(() => {
    const sv = searchParams?.get('status_view');
    return (sv === 'active' || sv === 'approved' || sv === 'paid') ? sv : 'all';
  });
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'my-assignments' | 'unassigned'>('all');
  const [sort, setSort] = useState<'recent' | 'oldest' | 'amount_desc' | 'amount_asc'>(() => {
    const s = searchParams?.get('sort');
    return (s === 'oldest' || s === 'amount_desc' || s === 'amount_asc') ? s : 'recent';
  });
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [filters, setFilters] = useState<InvoiceFilters>(defaultFilters);

  // Update URL params when state changes
  useEffect(() => {
    const params = new URLSearchParams();
    if (page !== 1) params.set('page', page.toString());
    if (searchTerm) params.set('search', searchTerm);
    if (view !== 'list') params.set('view', view);
    if (statusView !== 'all') params.set('status_view', statusView);
    if (sort !== 'recent') params.set('sort', sort);

    const newUrl = params.toString() ? `?${params.toString()}` : '/dashboard/invoices';
    router.replace(newUrl, { scroll: false });
  }, [page, searchTerm, view, statusView, sort, router]);

  // Set page header
  useEffect(() => {
    // Remove breadcrumb header content on this page
    setHeader({ title: '' });
  }, [setHeader]);

  // Fetch invoice counts by status with unread tracking
  const { data: countsData } = useQuery({
    queryKey: ['invoice-counts', currentAgentId],
    queryFn: () => invoicesApi.counts(currentAgentId || undefined),
    enabled: currentAgentId !== null,
  });

  // Dashboard analytics (totals, vendors, heatmap)
  const {
    data: dashboardData,
    isLoading: isDashboardLoading,
    error: dashboardError,
  } = useQuery<InvoiceDashboardResponse, Error>({
    queryKey: ['invoice-dashboard'],
    queryFn: () => invoicesApi.analytics(6),
  });

  // Fetch invoices with view filter
  const { data, isLoading, error } = useQuery({
    queryKey: ['invoices', page, limit, statusView, unreadOnly, currentAgentId],
    queryFn: () => invoicesApi.list(limit, (page - 1) * limit, {
      view: statusView,
      unread_only: unreadOnly,
      user_id: currentAgentId || undefined,
    }),
  });

  // Calculate stats from counts data
  const openCount = dashboardData?.stats.open.count ?? countsData?.active.total ?? 0;
  const onHoldCount = dashboardData?.stats.onHold.count ?? 0;
  const discrepanciesCount = dashboardData?.stats.discrepancies.count ?? 0;

  // Get view label for dropdown
  const getViewLabel = (viewFilter: InvoiceViewFilter) => {
    switch (viewFilter) {
      case 'active': return 'Active';
      case 'approved': return 'Ready to Pay';
      case 'paid': return 'Paid';
      default: return 'All Invoices';
    }
  };

  // Get unread count for a view
  const getUnreadCount = (viewFilter: InvoiceViewFilter) => {
    if (!countsData) return 0;
    switch (viewFilter) {
      case 'active': return countsData.active.unread;
      case 'approved': return countsData.approved.unread;
      case 'paid': return countsData.paid.unread;
      default: return countsData.all.unread;
    }
  };

  // Filter invoices by search term and filters
  const filteredInvoices = useMemo(() => {
    return data?.extractions.filter((invoice) => {
      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const vendor = getInvoiceValue(invoice, 'vendor', '') as string;
        const accountNr = getInvoiceValue(invoice, 'account_number', '') as string;
        const matchesSearch =
          invoice.file_name.toLowerCase().includes(searchLower) ||
          vendor.toLowerCase().includes(searchLower) ||
          accountNr.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (filters.status !== 'all' && invoice.status !== filters.status) {
        return false;
      }

      // Vendors filter
      if (filters.vendors.length > 0) {
        const vendor = getInvoiceValue(invoice, 'vendor', '') as string;
        if (!filters.vendors.includes(vendor)) return false;
      }

      // Invoice types filter
      if (filters.invoiceTypes.length > 0) {
        const isLineItems = invoice.has_line_items;
        const invoiceType = isLineItems ? 'line_items' : 'standard';
        if (!filters.invoiceTypes.includes(invoiceType)) return false;
      }

      // Assignees filter
      if (filters.assignees.length > 0) {
        if (!invoice.assigned_agent_id || !filters.assignees.includes(invoice.assigned_agent_id)) {
          return false;
        }
      }

      // Issue date range filter
      if (filters.issueDateRange.start || filters.issueDateRange.end) {
        const issuedDate = getInvoiceValue(invoice, 'invoice_date', '') as string;
        if (!issuedDate || issuedDate === '-') return false;
        const invoiceDate = new Date(issuedDate);
        if (filters.issueDateRange.start) {
          const startDate = new Date(filters.issueDateRange.start);
          if (invoiceDate < startDate) return false;
        }
        if (filters.issueDateRange.end) {
          const endDate = new Date(filters.issueDateRange.end);
          endDate.setHours(23, 59, 59, 999); // Include the entire end day
          if (invoiceDate > endDate) return false;
        }
      }

      // Due date range filter
      if (filters.dueDateRange.start || filters.dueDateRange.end) {
        const dueDate = getInvoiceValue(invoice, 'due_date', '') as string;
        if (!dueDate || dueDate === '-') return false;
        const invoiceDueDate = new Date(dueDate);
        if (filters.dueDateRange.start) {
          const startDate = new Date(filters.dueDateRange.start);
          if (invoiceDueDate < startDate) return false;
        }
        if (filters.dueDateRange.end) {
          const endDate = new Date(filters.dueDateRange.end);
          endDate.setHours(23, 59, 59, 999);
          if (invoiceDueDate > endDate) return false;
        }
      }

      // Assignment filter (My Assignments / Unassigned)
      if (assignmentFilter === 'my-assignments') {
        if (!currentAgentId || invoice.assigned_agent_id !== currentAgentId) {
          return false;
        }
      }
      if (assignmentFilter === 'unassigned') {
        if (invoice.assigned_agent_id !== null) {
          return false;
        }
      }

      return true;
    }) || [];
  }, [data?.extractions, searchTerm, filters, assignmentFilter, currentAgentId]);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.status !== 'all') count++;
    if (filters.vendors.length > 0) count++;
    if (filters.invoiceTypes.length > 0) count++;
    if (filters.assignees.length > 0) count++;
    if (filters.issueDateRange.start || filters.issueDateRange.end) count++;
    if (filters.dueDateRange.start || filters.dueDateRange.end) count++;
    return count;
  }, [filters]);

  const sortedInvoices = useMemo(() => {
    const arr = [...filteredInvoices];
    switch (sort) {
      case 'oldest':
        return arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case 'amount_desc':
        return arr.sort((a, b) => ((b.consensus_data.gross_amount as number) || 0) - ((a.consensus_data.gross_amount as number) || 0));
      case 'amount_asc':
        return arr.sort((a, b) => ((a.consensus_data.gross_amount as number) || 0) - ((b.consensus_data.gross_amount as number) || 0));
      case 'recent':
      default:
        return arr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
  }, [filteredInvoices, sort]);

  const handlePageChange = (offset: number) => {
    setPage(Math.floor(offset / limit) + 1);
  };

  return (
    <div className="space-y-6 p-6">
      <InvoiceDashboardOverview
        data={dashboardData}
        isLoading={isDashboardLoading}
        error={dashboardError}
      />

      {/* Header with Status View Dropdown */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-gray-700">Invoices</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                {getViewLabel(statusView)}
                {getUnreadCount(statusView) > 0 && (
                  <Badge variant="secondary" className="ml-1 bg-yellow-100 text-yellow-800 text-xs px-1.5">
                    {getUnreadCount(statusView)}
                  </Badge>
                )}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuItem
                onClick={() => { setStatusView('active'); setUnreadOnly(false); }}
                className="flex flex-col items-start gap-0.5 py-2"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="font-medium">Active</span>
                  {countsData?.active.unread ? (
                    <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 text-xs">
                      {countsData.active.unread} unread
                    </Badge>
                  ) : null}
                </div>
                <span className="text-xs text-gray-500">Select to view all open invoices</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => { setStatusView('approved'); setUnreadOnly(false); }}
                className="flex flex-col items-start gap-0.5 py-2"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="font-medium">Ready to Pay</span>
                </div>
                <span className="text-xs text-gray-500">View invoices ready for payment</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => { setStatusView('paid'); setUnreadOnly(false); }}
                className="flex flex-col items-start gap-0.5 py-2"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="font-medium">Paid</span>
                  {countsData?.paid.unread ? (
                    <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 text-xs">
                      {countsData.paid.unread} unread
                    </Badge>
                  ) : null}
                </div>
                <span className="text-xs text-gray-500">View all paid invoices</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => { setStatusView('all'); setUnreadOnly(false); }}
                className="flex flex-col items-start gap-0.5 py-2"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    {statusView === 'all' && <Check className="h-4 w-4 text-green-600" />}
                    <span className="font-medium">All Invoices</span>
                  </div>
                  {countsData?.all.unread ? (
                    <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 text-xs">
                      {countsData.all.unread} unread
                    </Badge>
                  ) : null}
                </div>
                <span className="text-xs text-gray-500">View all invoices including active, approved, and paid.</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* View Unread Invoices Button */}
        {getUnreadCount(statusView) > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setUnreadOnly(!unreadOnly)}
            className={unreadOnly ? 'bg-yellow-50 border-yellow-300' : ''}
          >
            <Eye className="h-4 w-4 mr-2" />
            {unreadOnly ? 'Show All' : 'View Unread Invoices'}
          </Button>
        )}

        {/* My Assignments Quick Filter */}
        <Button
          variant={assignmentFilter === 'my-assignments' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setAssignmentFilter(assignmentFilter === 'my-assignments' ? 'all' : 'my-assignments')}
          className={assignmentFilter === 'my-assignments' ? 'bg-[#d9fd9d] hover:bg-[#c5e389] text-black' : ''}
        >
          My Assignments
          {countsData?.myAssignments && countsData.myAssignments.total > 0 && (
            <Badge variant="secondary" className="ml-2 bg-yellow-100 text-yellow-800 text-xs px-1.5">
              {countsData.myAssignments.total}
            </Badge>
          )}
        </Button>

        {/* Unassigned Quick Filter */}
        <Button
          variant={assignmentFilter === 'unassigned' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setAssignmentFilter(assignmentFilter === 'unassigned' ? 'all' : 'unassigned')}
          className={assignmentFilter === 'unassigned' ? 'bg-orange-100 border-orange-300 text-orange-800 hover:bg-orange-200' : ''}
        >
          Unassigned
          {countsData?.unassigned && countsData.unassigned.total > 0 && (
            <Badge variant="secondary" className="ml-2 bg-orange-100 text-orange-800 text-xs px-1.5">
              {countsData.unassigned.total}
            </Badge>
          )}
        </Button>
      </div>

      {/* Top Controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search invoices..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 w-full"
          />
          <kbd className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-gray-100 px-1.5 font-mono text-xs font-medium text-gray-600">
            ⌘K
          </kbd>
        </div>
        <div className="flex items-center space-x-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilterDialogOpen(true)}
            className="relative"
          >
            <Filter className="h-4 w-4 mr-2" />
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="default" className="ml-2 h-5 min-w-5 px-1.5 text-xs">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Date: {sort === 'recent' ? 'Recent First' : sort === 'oldest' ? 'Oldest First' : sort === 'amount_desc' ? 'Amount High-Low' : 'Amount Low-High'}
                <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSort('recent')}>Date: Recent First</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSort('oldest')}>Date: Oldest First</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSort('amount_desc')}>Amount: High → Low</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSort('amount_asc')}>Amount: Low → High</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            onClick={() => setExportDialogOpen(true)}
            disabled={sortedInvoices.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Link href="/dashboard/invoices/vendors">
            <Button variant="outline">
              <Building className="h-4 w-4 mr-2" />
              Vendors
            </Button>
          </Link>
          <InvoiceUploadDialog
            trigger={
              <Button>
                <Upload className="h-4 w-4 mr-2" />
                Upload Invoice
              </Button>
            }
          />
        </div>
      </div>

      {/* Stats Cards (compact, aligned) */}
      <div className="mt-1">
        <InvoiceStatsCards
          openCount={openCount}
          onHoldCount={onHoldCount}
          discrepanciesCount={discrepanciesCount}
        />
      </div>

      {/* View selector - full width, below controls and above content */}
      <div className="w-full">
        <Tabs value={view} onValueChange={(v) => setView(v as typeof view)} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="list" className="flex items-center space-x-2">
              <List className="h-4 w-4" />
              <span>List View</span>
            </TabsTrigger>
            <TabsTrigger value="vendor" className="flex items-center space-x-2">
              <BarChart3 className="h-4 w-4" />
              <span>Vendor View</span>
            </TabsTrigger>
            <TabsTrigger value="monthly" className="flex items-center space-x-2">
              <Calendar className="h-4 w-4" />
              <span>Monthly View</span>
            </TabsTrigger>
            <TabsTrigger value="accounting" className="flex items-center space-x-2">
              <FileSpreadsheet className="h-4 w-4" />
              <span>Accounting</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Views */}
      {view === 'accounting' ? (
        <AccountingView />
      ) : view === 'list' ? (
        <Card className="p-4">
        {error ? (
          <div className="text-center py-12">
            <p className="text-red-600">Failed to load invoices</p>
            <p className="text-sm text-gray-500 mt-2">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
          ) : (
            <InvoiceTable
              invoices={sortedInvoices}
              isLoading={isLoading}
              pagination={data?.pagination}
              onPageChange={handlePageChange}
              currentAgentId={currentAgentId}
            />
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          {error ? (
            <div className="text-center py-12">
              <p className="text-red-600">Failed to load invoices</p>
              <p className="text-sm text-gray-500 mt-2">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
            </div>
          ) : view === 'vendor' ? (
            <GroupedByVendor invoices={sortedInvoices} isLoading={isLoading} />
          ) : (
            <GroupedByMonth invoices={sortedInvoices} isLoading={isLoading} />
          )}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredInvoices.length === 0 && (
        <Card className="p-12">
          <div className="text-center">
            <div className="mx-auto w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <Upload className="h-12 w-12 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No invoices yet</h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Upload your first invoice to get started with automated OCR extraction and data analysis.
            </p>
            <InvoiceUploadDialog
              trigger={
                <Button size="lg">
                  <Upload className="h-5 w-5 mr-2" />
                  Upload Your First Invoice
                </Button>
              }
            />
          </div>
        </Card>
      )}

      {/* Export Dialog */}
      <InvoiceExportDialog
        invoices={sortedInvoices}
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
      />

      {/* Filter Dialog */}
      <InvoiceFilterDialog
        open={filterDialogOpen}
        onOpenChange={setFilterDialogOpen}
        filters={filters}
        onApplyFilters={setFilters}
      />
    </div>
  );
}

/**
 * Vendor View Component
 * Groups invoices by vendor and displays them in collapsible sections.
 *
 * How it works:
 * 1. Creates a Map to group invoices by vendor name
 * 2. For each vendor, calculates total invoice amount across all their invoices
 * 3. Sorts vendors by total amount (highest first)
 * 4. Displays each vendor in a card with their invoice list
 */
function GroupedByVendor({ invoices, isLoading }: { invoices: InvoiceExtractionRecord[]; isLoading?: boolean }) {
  const groups = useMemo(() => {
    // Map structure: vendor name -> { total amount, invoice rows }
    const map = new Map<string, { total: number; rows: InvoiceExtractionRecord[] }>();

    // Group invoices by vendor and sum amounts
    for (const inv of invoices) {
      const vendor = getInvoiceValue(inv, 'vendor', 'Unknown') as string;
      const amount = Number(inv.consensus_data.gross_amount) || 0;

      // Initialize vendor group if doesn't exist
      if (!map.has(vendor)) map.set(vendor, { total: 0, rows: [] });

      // Add invoice to vendor's group and sum the amount
      const g = map.get(vendor)!;
      g.total += amount;
      g.rows.push(inv);
    }

    // Convert Map to array and sort by total amount (descending)
    return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [invoices]);

  if (isLoading) return <div className="h-24 bg-gray-100 animate-pulse rounded" />;

  return (
    <div className="space-y-4">
      {groups.map(([vendor, { total, rows }]) => (
        <div key={vendor} className="rounded-md border">
          <div className="flex items-center justify-between px-4 py-3 text-sm font-medium bg-gray-50 rounded-t-md">
            <div>
              <span className="mr-2">{vendor}</span>
              <span className="text-gray-500">{rows.length} {rows.length === 1 ? 'invoice' : 'invoices'}</span>
            </div>
            <div className="font-semibold">{formatCurrency(total, (rows[0]?.consensus_data.currency as string) || 'EUR')}</div>
          </div>
          <div className="px-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Invoice Nr.</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Issued Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Invoice Amount</TableHead>
                  <TableHead>Discrepancy</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{getInvoiceValue(r, 'account_number', r.file_name.substring(0, 20)) as string}</TableCell>
                    <TableCell className="font-medium">{getInvoiceValue(r, 'vendor', '-') as string}</TableCell>
                    <TableCell className="text-sm text-gray-600">{formatInvoiceDateForTable(getInvoiceValue(r, 'invoice_date', '-') as string)}</TableCell>
                    <TableCell>
                      <span className={`text-sm ${isInvoiceDueDateUrgent(getInvoiceValue(r, 'due_date', '-') as string, r.status) ? 'text-red-500 font-medium' : 'text-gray-900'}`}>
                        {formatInvoiceDateForTable(getInvoiceValue(r, 'due_date', '-') as string)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency((r.consensus_data.gross_amount as number) || 0, (r.consensus_data.currency as string) || 'EUR')}</TableCell>
                    <TableCell className="text-sm text-gray-600">-</TableCell>
                    <TableCell>
                      {r.payment_status === 'paid' ? (
                        <span className="inline-flex items-center text-sm text-blue-600"><span className="w-2 h-2 bg-blue-600 rounded-full mr-2" />Paid</span>
                      ) : r.status === 'approved' ? (
                        <span className="inline-flex items-center text-sm text-green-600"><span className="w-2 h-2 bg-green-600 rounded-full mr-2" />Approved</span>
                      ) : r.status === 'on_hold' ? (
                        <span className="inline-flex items-center text-sm text-orange-600"><span className="w-2 h-2 bg-orange-600 rounded-full mr-2" />On Hold</span>
                      ) : r.status === 'rejected' ? (
                        <span className="inline-flex items-center text-sm text-red-600"><span className="w-2 h-2 bg-red-600 rounded-full mr-2" />Deleted</span>
                      ) : (
                        <span className="inline-flex items-center text-sm text-yellow-600"><span className="w-2 h-2 bg-yellow-600 rounded-full mr-2" />Pending</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-0 py-2 text-sm text-gray-600">Showing 1 to {rows.length} of {rows.length} invoices</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Monthly View Component
 * Groups invoices by month and displays them in chronological sections.
 *
 * How it works:
 * 1. Converts invoice creation dates to month keys (e.g., "Jan 2024")
 * 2. Groups invoices by these month keys
 * 3. For each month, calculates total invoice amount
 * 4. Sorts months chronologically (most recent first)
 * 5. Displays each month in a card with its invoice list
 */
function GroupedByMonth({ invoices, isLoading }: { invoices: InvoiceExtractionRecord[]; isLoading?: boolean }) {
  const groups = useMemo(() => {
    // Helper: Convert date string to "Mon YYYY" format (e.g., "Jan 2024")
    const toMonthKey = (d: string) => {
      const date = new Date(d);
      return `${date.toLocaleString('en-US', { month: 'short' })} ${date.getFullYear()}`;
    };

    // Map structure: month key -> { total amount, invoice rows }
    const map = new Map<string, { total: number; rows: InvoiceExtractionRecord[] }>();

    // Group invoices by month and sum amounts
    for (const inv of invoices) {
      const key = toMonthKey(inv.created_at);
      const amount = Number(inv.consensus_data.gross_amount) || 0;

      // Initialize month group if doesn't exist
      if (!map.has(key)) map.set(key, { total: 0, rows: [] });

      // Add invoice to month's group and sum the amount
      const g = map.get(key)!;
      g.total += amount;
      g.rows.push(inv);
    }

    // Convert Map to array and sort by date (most recent first)
    return Array.from(map.entries()).sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime());
  }, [invoices]);

  if (isLoading) return <div className="h-24 bg-gray-100 animate-pulse rounded" />;

  return (
    <div className="space-y-4">
      {groups.map(([month, { total, rows }]) => (
        <div key={month} className="rounded-md border">
          <div className="flex items-center justify-between px-4 py-3 text-sm font-medium bg-gray-50 rounded-t-md">
            <div>{month}</div>
            <div className="font-semibold">{formatCurrency(total, (rows[0]?.consensus_data.currency as string) || 'EUR')}</div>
          </div>
          <div className="px-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Invoice Nr.</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Issued Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Invoice Amount</TableHead>
                  <TableHead>Discrepancy</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{getInvoiceValue(r, 'account_number', r.file_name.substring(0, 20)) as string}</TableCell>
                    <TableCell className="font-medium">{getInvoiceValue(r, 'vendor', '-') as string}</TableCell>
                    <TableCell className="text-sm text-gray-600">{formatInvoiceDateForTable(getInvoiceValue(r, 'invoice_date', '-') as string)}</TableCell>
                    <TableCell>
                      <span className={`text-sm ${isInvoiceDueDateUrgent(getInvoiceValue(r, 'due_date', '-') as string, r.status) ? 'text-red-500 font-medium' : 'text-gray-900'}`}>
                        {formatInvoiceDateForTable(getInvoiceValue(r, 'due_date', '-') as string)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency((r.consensus_data.gross_amount as number) || 0, (r.consensus_data.currency as string) || 'EUR')}</TableCell>
                    <TableCell className="text-sm text-gray-600">-</TableCell>
                    <TableCell>
                      {r.payment_status === 'paid' ? (
                        <span className="inline-flex items-center text-sm text-blue-600"><span className="w-2 h-2 bg-blue-600 rounded-full mr-2" />Paid</span>
                      ) : r.status === 'approved' ? (
                        <span className="inline-flex items-center text-sm text-green-600"><span className="w-2 h-2 bg-green-600 rounded-full mr-2" />Approved</span>
                      ) : r.status === 'on_hold' ? (
                        <span className="inline-flex items-center text-sm text-orange-600"><span className="w-2 h-2 bg-orange-600 rounded-full mr-2" />On Hold</span>
                      ) : r.status === 'rejected' ? (
                        <span className="inline-flex items-center text-sm text-red-600"><span className="w-2 h-2 bg-red-600 rounded-full mr-2" />Deleted</span>
                      ) : (
                        <span className="inline-flex items-center text-sm text-yellow-600"><span className="w-2 h-2 bg-yellow-600 rounded-full mr-2" />Pending</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-0 py-2 text-sm text-gray-600">Showing 1 to {rows.length} of {rows.length} invoices</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    }>
      <InvoicesPageContent />
    </Suspense>
  );
}

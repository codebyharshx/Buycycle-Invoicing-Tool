'use client';

/**
 * Data Sources Dashboard Page
 * Manage email-based invoice ingestion sources
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  dataSourcesApi,
  type InvoiceDataSource,
  type CreateInvoiceDataSourceRequest,
  type UpdateInvoiceDataSourceRequest,
} from '@/lib/api';
import { DataSourceTable } from '@/components/invoices/data-source-table';
import { DataSourceModal } from '@/components/invoices/data-source-modal';
import { usePageHeader } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Search, ArrowLeft, Mail } from 'lucide-react';
import Link from 'next/link';

export default function DataSourcesPage() {
  const { setHeader } = usePageHeader();
  const queryClient = useQueryClient();

  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(50);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDataSource, setEditingDataSource] = useState<InvoiceDataSource | null>(null);
  const [archiveDataSource, setArchiveDataSource] = useState<InvoiceDataSource | null>(null);

  // Set page header
  useEffect(() => {
    setHeader({ title: 'Email Data Sources' });
  }, [setHeader]);

  // Fetch data sources
  const {
    data: dataSourcesData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['invoice-data-sources', searchTerm, page, limit],
    queryFn: () =>
      dataSourcesApi.list({
        search: searchTerm || undefined,
        limit,
        offset: (page - 1) * limit,
      }),
  });

  // Create data source mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateInvoiceDataSourceRequest) => dataSourcesApi.create(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['invoice-data-sources'] });
      toast.success(`Data source "${response.data.name}" created`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create data source');
    },
  });

  // Update data source mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateInvoiceDataSourceRequest }) =>
      dataSourcesApi.update(id, data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['invoice-data-sources'] });
      toast.success(`Data source "${response.data.name}" updated`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update data source');
    },
  });

  // Archive data source mutation
  const archiveMutation = useMutation({
    mutationFn: (id: number) => dataSourcesApi.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-data-sources'] });
      toast.success('Data source archived');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to archive data source');
    },
  });

  // Handlers
  const handleAddDataSource = () => {
    setEditingDataSource(null);
    setIsModalOpen(true);
  };

  const handleEditDataSource = (ds: InvoiceDataSource) => {
    setEditingDataSource(ds);
    setIsModalOpen(true);
  };

  const handleArchiveDataSource = (ds: InvoiceDataSource) => {
    setArchiveDataSource(ds);
  };

  const handleSaveDataSource = async (data: CreateInvoiceDataSourceRequest | UpdateInvoiceDataSourceRequest) => {
    if (editingDataSource) {
      await updateMutation.mutateAsync({ id: editingDataSource.id, data });
    } else {
      await createMutation.mutateAsync(data as CreateInvoiceDataSourceRequest);
    }
  };

  const handleConfirmArchive = async () => {
    if (archiveDataSource) {
      await archiveMutation.mutateAsync(archiveDataSource.id);
      setArchiveDataSource(null);
    }
  };

  const handlePageChange = (offset: number) => {
    setPage(Math.floor(offset / limit) + 1);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/invoices">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Invoices
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Mail className="h-6 w-6" />
              Email Data Sources
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Configure email addresses for automatic invoice ingestion
            </p>
          </div>
        </div>
        <Button onClick={handleAddDataSource}>
          <Plus className="h-4 w-4 mr-1" />
          Add Data Source
        </Button>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-1">How it works</h3>
        <p className="text-sm text-blue-800">
          Create an email data source with a unique email address (e.g., <code className="bg-blue-100 px-1 rounded">ups@invoices.buycycle.com</code>).
          When carriers send invoices to this address, they are automatically processed through OCR
          and added to the invoice system.
        </p>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {/* Error state */}
      {error && (
        <div className="text-red-500 bg-red-50 p-4 rounded">
          Failed to load data sources: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Data Source Table */}
      <DataSourceTable
        dataSources={dataSourcesData?.data || []}
        isLoading={isLoading}
        pagination={undefined}
        onPageChange={handlePageChange}
        onEdit={handleEditDataSource}
        onArchive={handleArchiveDataSource}
      />

      {/* Add/Edit Modal */}
      <DataSourceModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        dataSource={editingDataSource}
        onSave={handleSaveDataSource}
      />

      {/* Archive Confirmation */}
      <Dialog open={!!archiveDataSource} onOpenChange={(open) => !open && setArchiveDataSource(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Data Source?</DialogTitle>
            <DialogDescription>
              Are you sure you want to archive &quot;{archiveDataSource?.name}&quot;?
              Emails sent to <code className="bg-gray-100 px-1 rounded">{archiveDataSource?.email_address}</code> will
              no longer be processed. This action can be undone by editing the data source.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveDataSource(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmArchive} className="bg-red-600 hover:bg-red-700">
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

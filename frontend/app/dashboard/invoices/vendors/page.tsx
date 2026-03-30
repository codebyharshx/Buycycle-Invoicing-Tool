'use client';

/**
 * Vendors Dashboard Page
 * Manage logistics invoice vendors
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { vendorsApi, type Vendor, type CreateVendorRequest, type UpdateVendorRequest } from '@/lib/api';
import { VendorTable } from '@/components/invoices/vendor-table';
import { VendorModal } from '@/components/invoices/vendor-modal';
import { VendorDeleteDialog } from '@/components/invoices/vendor-delete-dialog';
import { usePageHeader } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function VendorsPage() {
  const { setHeader } = usePageHeader();
  const queryClient = useQueryClient();

  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(50);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [deleteVendor, setDeleteVendor] = useState<Vendor | null>(null);

  // Set page header
  useEffect(() => {
    setHeader({ title: 'Vendors' });
  }, [setHeader]);

  // Fetch vendors
  const {
    data: vendorsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['vendors', searchTerm, page, limit],
    queryFn: () =>
      vendorsApi.list({
        search: searchTerm || undefined,
        limit,
        offset: (page - 1) * limit,
      }),
  });

  // Create vendor mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateVendorRequest) => vendorsApi.create(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      toast.success(`Vendor "${response.data.name}" created`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create vendor');
    },
  });

  // Update vendor mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateVendorRequest }) =>
      vendorsApi.update(id, data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      toast.success(`Vendor "${response.data.name}" updated`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update vendor');
    },
  });

  // Delete vendor mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => vendorsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      toast.success('Vendor deleted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete vendor');
    },
  });

  // Handlers
  const handleAddVendor = () => {
    setEditingVendor(null);
    setIsModalOpen(true);
  };

  const handleEditVendor = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setIsModalOpen(true);
  };

  const handleDeleteVendor = (vendor: Vendor) => {
    setDeleteVendor(vendor);
  };

  const handleSaveVendor = async (data: CreateVendorRequest | UpdateVendorRequest) => {
    if (editingVendor) {
      await updateMutation.mutateAsync({ id: editingVendor.id, data });
    } else {
      await createMutation.mutateAsync(data as CreateVendorRequest);
    }
  };

  const handleConfirmDelete = async () => {
    if (deleteVendor) {
      await deleteMutation.mutateAsync(deleteVendor.id);
      setDeleteVendor(null);
    }
  };

  const handlePageChange = (offset: number) => {
    setPage(Math.floor(offset / limit) + 1);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1); // Reset to first page on search
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
          <h1 className="text-2xl font-semibold">Vendors</h1>
        </div>
        <Button onClick={handleAddVendor}>
          <Plus className="h-4 w-4 mr-1" />
          Add Vendor
        </Button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search vendors by name..."
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
          Failed to load vendors: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Vendor Table */}
      <VendorTable
        vendors={vendorsData?.data || []}
        isLoading={isLoading}
        pagination={undefined}
        onPageChange={handlePageChange}
        onEdit={handleEditVendor}
        onDelete={handleDeleteVendor}
      />

      {/* Add/Edit Modal */}
      <VendorModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        vendor={editingVendor}
        onSave={handleSaveVendor}
      />

      {/* Delete Confirmation */}
      <VendorDeleteDialog
        open={!!deleteVendor}
        onOpenChange={(open) => !open && setDeleteVendor(null)}
        vendor={deleteVendor}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

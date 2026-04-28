'use client';

/**
 * Manage Tags Dialog
 * Full CRUD modal for managing invoice tags.
 * Allows creating, editing, and deleting tags.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Pencil, Trash2, Check, X, Loader2, Search } from 'lucide-react';
import { invoiceTagsApi } from '@/lib/api';
import type { InvoiceTag } from '@shared/types';
import { toast } from 'sonner';

interface ManageTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail: string;
}

export function ManageTagsDialog({ open, onOpenChange, userEmail }: ManageTagsDialogProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagDescription, setNewTagDescription] = useState('');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Fetch all tags
  const { data: tagsData, isLoading } = useQuery({
    queryKey: ['invoice-tags'],
    queryFn: () => invoiceTagsApi.list(),
    enabled: open,
  });

  const tags: InvoiceTag[] = tagsData?.data || [];
  const filteredTags = tags.filter(
    (tag) =>
      tag.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (tag.description && tag.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Create tag mutation
  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; createdBy?: string }) =>
      invoiceTagsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-tags'] });
      setNewTagName('');
      setNewTagDescription('');
      setIsAddingNew(false);
      toast.success('Tag created');
    },
    onError: (error: unknown) => {
      // Check for duplicate tag error (409 Conflict)
      const axiosError = error as { response?: { status?: number; data?: { message?: string; code?: string } } };
      if (axiosError.response?.status === 409 || axiosError.response?.data?.code === 'DUPLICATE_TAG') {
        toast.error(axiosError.response?.data?.message || 'A tag with this name already exists');
      } else {
        toast.error('Failed to create tag');
      }
    },
  });

  // Update tag mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; description?: string } }) =>
      invoiceTagsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-tags'] });
      setEditingId(null);
      toast.success('Tag updated');
    },
    onError: (error: unknown) => {
      // Check for duplicate tag error (409 Conflict)
      const axiosError = error as { response?: { status?: number; data?: { message?: string; code?: string } } };
      if (axiosError.response?.status === 409 || axiosError.response?.data?.code === 'DUPLICATE_TAG') {
        toast.error(axiosError.response?.data?.message || 'A tag with this name already exists');
      } else {
        toast.error('Failed to update tag');
      }
    },
  });

  // Delete tag mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => invoiceTagsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-tags'] });
      setDeletingId(null);
      toast.success('Tag deleted');
    },
    onError: () => {
      toast.error('Failed to delete tag');
    },
  });

  const handleCreate = () => {
    if (!newTagName.trim()) return;
    createMutation.mutate({
      name: newTagName.trim(),
      description: newTagDescription.trim() || undefined,
      createdBy: userEmail,
    });
  };

  const handleStartEdit = (tag: InvoiceTag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditDescription(tag.description || '');
  };

  const handleSaveEdit = () => {
    if (editingId === null || !editName.trim()) return;
    updateMutation.mutate({
      id: editingId,
      data: {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
      },
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditDescription('');
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Manage Invoice Tags</DialogTitle>
          <DialogDescription>
            Create, edit, and delete tags for invoices.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search and Add */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <Button
              size="sm"
              onClick={() => setIsAddingNew(true)}
              disabled={isAddingNew}
              className="h-9"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Tag
            </Button>
          </div>

          {/* New tag form */}
          {isAddingNew && (
            <div className="border rounded-lg p-3 space-y-2 bg-gray-50">
              <Input
                placeholder="Tag name"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className="h-8 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') {
                    setIsAddingNew(false);
                    setNewTagName('');
                    setNewTagDescription('');
                  }
                }}
              />
              <Input
                placeholder="Description (optional)"
                value={newTagDescription}
                onChange={(e) => setNewTagDescription(e.target.value)}
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') {
                    setIsAddingNew(false);
                    setNewTagName('');
                    setNewTagDescription('');
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setIsAddingNew(false);
                    setNewTagName('');
                    setNewTagDescription('');
                  }}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={!newTagName.trim() || createMutation.isPending}
                  className="h-7 text-xs"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Check className="h-3 w-3 mr-1" />
                  )}
                  Create
                </Button>
              </div>
            </div>
          )}

          {/* Tags list */}
          <div className="border rounded-lg divide-y max-h-[350px] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading tags...
              </div>
            ) : filteredTags.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-500">
                {searchQuery ? 'No tags matching your search' : 'No tags created yet'}
              </div>
            ) : (
              filteredTags.map((tag) => (
                <div key={tag.id} className="group">
                  {editingId === tag.id ? (
                    /* Edit mode */
                    <div className="p-3 space-y-2 bg-blue-50">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit();
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                      />
                      <Input
                        placeholder="Description (optional)"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="h-8 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit();
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleCancelEdit}
                          className="h-7 text-xs"
                        >
                          <X className="h-3 w-3 mr-1" />
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSaveEdit}
                          disabled={!editName.trim() || updateMutation.isPending}
                          className="h-7 text-xs"
                        >
                          {updateMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Check className="h-3 w-3 mr-1" />
                          )}
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : deletingId === tag.id ? (
                    /* Delete confirmation */
                    <div className="p-3 bg-red-50">
                      <p className="text-sm text-red-800 mb-2">
                        Delete tag &quot;{tag.name}&quot;? This will remove it from all invoices.
                      </p>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeletingId(null)}
                          className="h-7 text-xs"
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(tag.id)}
                          disabled={deleteMutation.isPending}
                          className="h-7 text-xs"
                        >
                          {deleteMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Trash2 className="h-3 w-3 mr-1" />
                          )}
                          Delete
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <div className="flex items-center justify-between px-3 py-2.5 hover:bg-gray-50">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{tag.name}</div>
                        {tag.description && (
                          <div className="text-xs text-gray-500 truncate">{tag.description}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleStartEdit(tag)}
                          className="p-1.5 hover:bg-gray-200 rounded"
                          title="Edit tag"
                        >
                          <Pencil className="h-3.5 w-3.5 text-gray-500" />
                        </button>
                        <button
                          onClick={() => setDeletingId(tag.id)}
                          className="p-1.5 hover:bg-red-100 rounded"
                          title="Delete tag"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

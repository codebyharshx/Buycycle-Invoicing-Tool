'use client';

/**
 * Invoice Tags Section
 * Shows assigned tags on an invoice with add/remove functionality
 * and a "Manage tags" link to open the management dialog.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { X, Tag, Plus, Settings, Loader2 } from 'lucide-react';
import { invoiceTagsApi } from '@/lib/api';
import type { InvoiceTag, InvoiceTagAssignment } from '@shared/types';
import { ManageTagsDialog } from './manage-tags-dialog';
import { toast } from 'sonner';

interface InvoiceTagsSectionProps {
  invoiceId: number;
  userEmail: string;
}

export function InvoiceTagsSection({ invoiceId, userEmail }: InvoiceTagsSectionProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const queryClient = useQueryClient();

  // Fetch all available tags
  const { data: allTagsData } = useQuery({
    queryKey: ['invoice-tags'],
    queryFn: () => invoiceTagsApi.list(),
  });

  // Fetch tags assigned to this invoice
  const { data: assignedTagsData, isLoading: isLoadingAssigned } = useQuery({
    queryKey: ['invoice-tags', invoiceId],
    queryFn: () => invoiceTagsApi.getForInvoice(invoiceId),
  });

  const allTags: InvoiceTag[] = allTagsData?.data || [];
  const assignedTags: InvoiceTagAssignment[] = assignedTagsData?.tags || [];
  const assignedTagIds = assignedTags.map(t => t.tagId);
  const selectableTags = allTags.filter(t => !assignedTagIds.includes(t.id));

  // Assign tag mutation
  const assignMutation = useMutation({
    mutationFn: (tagId: number) => invoiceTagsApi.assignToInvoice(invoiceId, tagId, userEmail),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-tags', invoiceId] });
    },
    onError: () => {
      toast.error('Failed to assign tag');
    },
  });

  // Remove tag mutation
  const removeMutation = useMutation({
    mutationFn: (tagId: number) => invoiceTagsApi.removeFromInvoice(invoiceId, tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-tags', invoiceId] });
    },
    onError: () => {
      toast.error('Failed to remove tag');
    },
  });

  const handleAddTag = (tagId: number) => {
    assignMutation.mutate(tagId);
    setAddOpen(false);
  };

  const handleRemoveTag = (tagId: number) => {
    removeMutation.mutate(tagId);
  };

  return (
    <div className="pt-2 pb-1">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Tag className="h-3.5 w-3.5 text-gray-500" />
          <span className="text-[11px] text-gray-500">Tags</span>
        </div>
        <button
          onClick={() => setManageOpen(true)}
          className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline"
        >
          <Settings className="h-3 w-3 inline mr-0.5" />
          Manage
        </button>
      </div>

      {/* Assigned tags */}
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {isLoadingAssigned ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading...
          </div>
        ) : assignedTags.length > 0 ? (
          assignedTags.map((assignment) => (
            <Badge
              key={assignment.id}
              variant="secondary"
              className="flex items-center gap-1 pr-1 text-xs"
            >
              {assignment.tag.name}
              <button
                onClick={() => handleRemoveTag(assignment.tagId)}
                className="ml-0.5 hover:bg-black/10 rounded-full p-0.5"
                title="Remove tag"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        ) : null}

        {/* Add tag button */}
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50"
            >
              <Plus className="h-3 w-3 mr-0.5" />
              Add tag
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[250px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search tags..." />
              <CommandList>
                <CommandEmpty>No tags found.</CommandEmpty>
                <CommandGroup>
                  {selectableTags.map((tag) => (
                    <CommandItem
                      key={tag.id}
                      value={tag.name}
                      onSelect={() => handleAddTag(tag.id)}
                      className="cursor-pointer"
                    >
                      <span className="flex-1">{tag.name}</span>
                      {tag.description && (
                        <span className="text-[10px] text-muted-foreground truncate ml-2 max-w-[100px]">
                          {tag.description}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Manage Tags Dialog */}
      <ManageTagsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        userEmail={userEmail}
      />
    </div>
  );
}

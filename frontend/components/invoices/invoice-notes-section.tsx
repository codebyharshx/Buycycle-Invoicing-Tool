'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MentionTextarea, renderNotesWithMentions } from '@/components/shared/mention-textarea';
import { threadsApi } from '@/lib/api';
import { Loader2, Plus, ChevronDown, Pencil, Trash2, X, Check, MessageSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { ThreadWithReplies } from '@shared/types';

interface InvoiceNotesSectionProps {
  invoiceId: string;
  userId: number | null;
  userName: string | null;
}

export function InvoiceNotesSection({ invoiceId, userId, userName }: InvoiceNotesSectionProps) {
  const queryClient = useQueryClient();
  const [newNote, setNewNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const composerRef = useRef<HTMLDivElement | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Close composer when clicking outside (only if empty)
  useEffect(() => {
    if (!composerOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (composerRef.current && target && !composerRef.current.contains(target)) {
        if (!newNote.trim()) {
          setComposerOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [composerOpen, newNote]);

  const queryKey = ['threads-invoice', invoiceId];

  const { data: threadsData, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      threadsApi.list(
        {
          entity_type: 'invoice',
          entity_id: invoiceId,
          sort: 'newest',
          limit: 50,
        },
        userId ?? undefined
      ),
    enabled: !!invoiceId,
  });

  const notes = threadsData?.threads?.filter((t: ThreadWithReplies) => !t.is_deleted) || [];

  const handleAddNote = async () => {
    if (!userId || !userName || !newNote.trim()) return;
    setIsSubmitting(true);
    try {
      await threadsApi.create(
        {
          entity_type: 'invoice',
          entity_id: invoiceId,
          content: newNote.trim(),
        },
        userId,
        userName
      );
      setNewNote('');
      setComposerOpen(false);
      queryClient.invalidateQueries({ queryKey });
    } catch {
      // Error is logged by API client
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = async (threadId: number) => {
    if (!userId || !editContent.trim()) return;
    setIsSavingEdit(true);
    try {
      await threadsApi.update(threadId, { content: editContent.trim() }, userId);
      setEditingId(null);
      setEditContent('');
      queryClient.invalidateQueries({ queryKey });
    } catch {
      // Error is logged by API client
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDelete = async (threadId: number) => {
    if (!userId) return;
    setDeletingId(null);
    try {
      await threadsApi.delete(threadId, userId);
      queryClient.invalidateQueries({ queryKey });
    } catch {
      // Error is logged by API client
    }
  };

  const getInitials = (name: string) => {
    const parts = (name || '').trim().split(/\s+/);
    const first = parts[0]?.[0] || '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  };

  return (
    <div className="pt-2 border-t">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-gray-500 font-medium">Notes</div>
        {notes.length > 0 && (
          <span className="text-[10px] text-gray-400">{notes.length} note{notes.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Notes list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : notes.length > 0 ? (
        <ScrollArea className={notes.length > 3 ? 'h-[260px] pr-2' : ''}>
          <div className="space-y-3">
            {notes.map((note: ThreadWithReplies) => (
              <div key={note.id} className="group relative">
                {editingId === note.id ? (
                  /* Edit mode */
                  <div className="space-y-2">
                    <MentionTextarea
                      value={editContent}
                      onChange={setEditContent}
                      placeholder="Edit note..."
                      className="min-h-[80px] text-[13px]"
                      excludeUserId={userId}
                    />
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] px-2"
                        onClick={() => { setEditingId(null); setEditContent(''); }}
                        disabled={isSavingEdit}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-[11px] px-2"
                        onClick={() => handleEdit(note.id)}
                        disabled={isSavingEdit || !editContent.trim()}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        {isSavingEdit ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </div>
                ) : deletingId === note.id ? (
                  /* Delete confirmation */
                  <div className="border border-red-200 rounded-md p-2 bg-red-50">
                    <div className="text-[11px] text-red-700 mb-2">Delete this note?</div>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] px-2"
                        onClick={() => setDeletingId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-6 text-[11px] px-2"
                        onClick={() => handleDelete(note.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Normal display */
                  <div className="flex items-start gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="h-6 w-6 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[9px] font-semibold select-none shrink-0 mt-0.5">
                          {getInitials(note.author_name)}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{note.author_name}</TooltipContent>
                    </Tooltip>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[11px] font-medium text-gray-900 truncate">
                          {note.author_name}
                        </span>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">
                          {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
                        </span>
                        {note.is_edited && (
                          <span className="text-[10px] text-gray-400 italic">(edited)</span>
                        )}
                      </div>
                      <div className="text-[13px] text-gray-700 whitespace-pre-wrap break-words">
                        {renderNotesWithMentions(note.content)}
                      </div>

                      {/* Edit/delete controls for own notes */}
                      {userId && note.author_id === userId && (
                        <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                          <button
                            className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5"
                            onClick={() => { setEditingId(note.id); setEditContent(note.content); }}
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                          <button
                            className="text-[10px] text-gray-400 hover:text-red-500 flex items-center gap-0.5"
                            onClick={() => setDeletingId(note.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="text-center py-4">
          <MessageSquare className="h-6 w-6 text-gray-300 mx-auto mb-1" />
          <p className="text-[11px] text-muted-foreground">No notes yet</p>
        </div>
      )}

      {/* Composer */}
      {userId && userName && (
        <div className="mt-3">
          {!composerOpen && (
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="w-full flex items-center justify-between rounded-md border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Plus className="h-3 w-3" />
                Add note
              </span>
              <ChevronDown className="h-3 w-3 opacity-70" />
            </button>
          )}

          <div
            className={`grid transition-all duration-300 ${
              composerOpen ? 'grid-rows-[1fr] mt-2' : 'grid-rows-[0fr]'
            }`}
          >
            <div className="overflow-hidden" ref={composerRef}>
              <div className="space-y-2">
                <MentionTextarea
                  value={newNote}
                  onChange={setNewNote}
                  placeholder="Write a note... Use @ to mention someone"
                  className="min-h-[80px] text-[13px]"
                  disabled={isSubmitting}
                  excludeUserId={userId}
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => { setComposerOpen(false); setNewNote(''); }}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={handleAddNote}
                    disabled={isSubmitting || !newNote.trim()}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {isSubmitting ? 'Adding...' : 'Add Note'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

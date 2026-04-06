/**
 * API client for the invoicing system
 */

import axios from 'axios';
import type {
  InvoiceExtractionRecord,
  InvoiceExtractionRecordWithLineItems,
  InvoiceStatusCounts,
  InvoiceViewFilter,
  InvoiceDashboardResponse,
  AccountingViewResponse,
  Vendor as SharedVendor,
  CreateVendorRequest as SharedCreateVendorRequest,
  UpdateVendorRequest as SharedUpdateVendorRequest,
} from '@shared/types';

// Re-export types
export type { InvoiceViewFilter };

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Agent types
export interface Agent {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role?: string;
}

// Vendor types - re-export from shared
export type Vendor = SharedVendor;
export type CreateVendorRequest = SharedCreateVendorRequest;
export type UpdateVendorRequest = SharedUpdateVendorRequest;

// Data source types
export interface InvoiceDataSource {
  id: number;
  name: string;
  email_address: string;
  status: 'active' | 'paused' | 'archived';
  vendor_hint: string | null;
  auto_process: boolean;
  description: string | null;
  created_by: number | null;
  last_received_at: string | null;
  total_emails_received: number;
  total_invoices_processed: number;
  created_at: string;
  updated_at: string;
}

export interface CreateInvoiceDataSourceRequest {
  name: string;
  email_address: string;
  vendor_hint?: string;
  auto_process?: boolean;
  description?: string;
  created_by?: number;
}

export interface UpdateInvoiceDataSourceRequest {
  name?: string;
  status?: 'active' | 'paused' | 'archived';
  vendor_hint?: string | null;
  auto_process?: boolean;
  description?: string | null;
}

// Invoice tag types - re-export from shared
import type { InvoiceTag as SharedInvoiceTag, InvoiceTagAssignment } from '@shared/types';
export type InvoiceTag = SharedInvoiceTag;
export type { InvoiceTagAssignment };

// Invoices API
export const invoicesApi = {
  list: async (
    limit: number = 20,
    offset: number = 0,
    options?: { view?: InvoiceViewFilter; unread_only?: boolean; user_id?: number }
  ) => {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    if (options?.view) params.set('view', options.view);
    if (options?.unread_only) params.set('unread_only', 'true');
    if (options?.user_id) params.set('user_id', options.user_id.toString());

    const response = await api.get<{
      extractions: InvoiceExtractionRecord[];
      pagination: { limit: number; offset: number; total: number; hasMore: boolean };
    }>(`/invoice-ocr/extractions?${params}`);
    return response.data;
  },

  get: async (id: number, includeLineItems: boolean = false) => {
    const params = includeLineItems ? '?include_line_items=true' : '';
    const response = await api.get<InvoiceExtractionRecordWithLineItems>(
      `/invoice-ocr/extractions/${id}${params}`
    );
    return response.data;
  },

  update: async (id: number, data: Partial<InvoiceExtractionRecord>) => {
    const response = await api.patch(`/invoice-ocr/extractions/${id}`, data);
    return response.data;
  },

  delete: async (id: number) => {
    const response = await api.delete(`/invoice-ocr/extractions/${id}`);
    return response.data;
  },

  assign: async (id: number, agentId: number | null) => {
    const response = await api.patch(`/invoice-ocr/extractions/${id}`, {
      assigned_agent_id: agentId,
    });
    return response.data;
  },

  counts: async (userId?: number) => {
    const params = userId ? `?user_id=${userId}` : '';
    const response = await api.get<InvoiceStatusCounts>(`/invoice-ocr/extractions/counts${params}`);
    return response.data;
  },

  analytics: async (months: number = 6) => {
    const response = await api.get<InvoiceDashboardResponse>(
      `/invoice-ocr/analytics?months=${months}`
    );
    return response.data;
  },

  markRead: async (id: number, userId: number) => {
    const response = await api.post(`/invoice-ocr/extractions/${id}/mark-read`, { user_id: userId });
    return response.data;
  },

  markAllRead: async (userId: number) => {
    const response = await api.post('/invoice-ocr/extractions/mark-all-read', { user_id: userId });
    return response.data;
  },

  upload: async (file: File, options?: { models?: string[]; created_via?: string; notes?: string }) => {
    const formData = new FormData();
    formData.append('invoice', file);
    if (options?.models) {
      formData.append('models', JSON.stringify(options.models));
    }
    if (options?.created_via) {
      formData.append('created_via', options.created_via);
    }
    if (options?.notes) {
      formData.append('notes', options.notes);
    }

    const response = await api.post('/invoice-ocr/extract', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  uploadWithLineItems: async (pdfFile: File, csvFile: File, options?: { models?: string[]; created_via?: string; notes?: string }) => {
    const formData = new FormData();
    formData.append('invoice', pdfFile);
    formData.append('csv', csvFile);
    if (options?.models) {
      formData.append('models', JSON.stringify(options.models));
    }
    if (options?.created_via) {
      formData.append('created_via', options.created_via);
    }
    if (options?.notes) {
      formData.append('notes', options.notes);
    }

    const response = await api.post('/invoice-ocr/extract-with-line-items', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  reprocessCSV: async (id: number, csvFile: File) => {
    const formData = new FormData();
    formData.append('csv', csvFile);

    const response = await api.post(`/invoice-ocr/${id}/reprocess-csv`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  accounting: async (params?: { dateFrom?: string; dateTo?: string; vendor?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.dateFrom) searchParams.set('dateFrom', params.dateFrom);
    if (params?.dateTo) searchParams.set('dateTo', params.dateTo);
    if (params?.vendor) searchParams.set('vendor', params.vendor);

    const response = await api.get<AccountingViewResponse>(
      `/invoice-ocr/accounting?${searchParams}`
    );
    return response.data;
  },

  updatePayment: async (id: number, data: { date?: string | null; method?: string | null; status?: string }) => {
    const response = await api.patch(`/invoice-ocr/extractions/${id}`, {
      payment_date: data.date,
      payment_method: data.method,
      payment_status: data.status,
    });
    return response.data;
  },

  accountingExport: async (params?: { dateFrom?: string; dateTo?: string; vendor?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.dateFrom) searchParams.set('dateFrom', params.dateFrom);
    if (params?.dateTo) searchParams.set('dateTo', params.dateTo);
    if (params?.vendor) searchParams.set('vendor', params.vendor);

    const response = await api.get(`/invoice-ocr/accounting/export?${searchParams}`, {
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  vendors: async () => {
    const response = await api.get<{ success: boolean; vendors: string[] }>('/invoice-ocr/vendors');
    return response.data;
  },

  getLinkedInvoices: async (id: number) => {
    const response = await api.get<{
      children: Array<{
        id: number;
        invoice_number: string;
        vendor: string;
        document_type: string;
        net_amount: number;
        gross_amount: number;
        currency: string;
        invoice_date: string;
        status: string;
        created_at: string;
      }>;
      parent: {
        id: number;
        invoice_number: string;
        vendor: string;
        document_type: string;
        net_amount: number;
        gross_amount: number;
        currency: string;
        invoice_date: string;
        status: string;
        created_at: string;
      } | null;
    }>(`/invoice-ocr/extractions/${id}/linked`);
    return response.data;
  },
};

// Vendors API
export const vendorsApi = {
  list: async (options?: { search?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (options?.search) params.set('search', options.search);
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    const queryString = params.toString();
    const response = await api.get<{ success: boolean; data: Vendor[] }>(
      `/vendors${queryString ? `?${queryString}` : ''}`
    );
    return response.data;
  },

  get: async (id: number) => {
    const response = await api.get<{ success: boolean; data: Vendor }>(`/vendors/${id}`);
    return response.data;
  },

  create: async (data: CreateVendorRequest) => {
    const response = await api.post<{ success: boolean; data: Vendor }>('/vendors', data);
    return response.data;
  },

  update: async (id: number, data: UpdateVendorRequest) => {
    const response = await api.put<{ success: boolean; data: Vendor }>(`/vendors/${id}`, data);
    return response.data;
  },

  delete: async (id: number) => {
    const response = await api.delete<{ success: boolean }>(`/vendors/${id}`);
    return response.data;
  },
};

// Agents API (for user/assignment data)
export const agentsApi = {
  list: async () => {
    const response = await api.get<{ success: boolean; data: Agent[] }>('/agents');
    return response.data;
  },
};

// Invoice Tags API
export const invoiceTagsApi = {
  list: async () => {
    const response = await api.get<{ success: boolean; data: InvoiceTag[] }>('/invoice-tags');
    return response.data;
  },

  create: async (data: { name: string; description?: string }) => {
    const response = await api.post<{ success: boolean; data: InvoiceTag }>('/invoice-tags', data);
    return response.data;
  },

  update: async (id: number, data: { name?: string; description?: string }) => {
    const response = await api.put<{ success: boolean; data: InvoiceTag }>(
      `/invoice-tags/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    const response = await api.delete<{ success: boolean }>(`/invoice-tags/${id}`);
    return response.data;
  },

  addToInvoice: async (invoiceId: number, tagId: number) => {
    const response = await api.post(`/invoices/${invoiceId}/tags`, { tag_id: tagId });
    return response.data;
  },

  removeFromInvoice: async (invoiceId: number, tagId: number) => {
    const response = await api.delete(`/invoices/${invoiceId}/tags/${tagId}`);
    return response.data;
  },

  getForInvoice: async (invoiceId: number) => {
    const response = await api.get<{ success: boolean; tags: InvoiceTagAssignment[] }>(
      `/invoices/${invoiceId}/tags`
    );
    return response.data;
  },

  assignToInvoice: async (invoiceId: number, tagId: number, assignedBy?: string) => {
    const response = await api.post(`/invoices/${invoiceId}/tags`, {
      tag_id: tagId,
      assigned_by: assignedBy,
    });
    return response.data;
  },

  unassignFromInvoice: async (invoiceId: number, tagId: number) => {
    const response = await api.delete(`/invoices/${invoiceId}/tags/${tagId}`);
    return response.data;
  },
};

// Data Sources API
export const dataSourcesApi = {
  list: async (options?: { search?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (options?.search) params.set('search', options.search);
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    const queryString = params.toString();
    const response = await api.get<{ success: boolean; data: InvoiceDataSource[] }>(
      `/invoice-data-sources${queryString ? `?${queryString}` : ''}`
    );
    return response.data;
  },

  get: async (id: number) => {
    const response = await api.get<{ success: boolean; data: InvoiceDataSource }>(
      `/invoice-data-sources/${id}`
    );
    return response.data;
  },

  create: async (data: CreateInvoiceDataSourceRequest) => {
    const response = await api.post<{ success: boolean; data: InvoiceDataSource }>(
      '/invoice-data-sources',
      data
    );
    return response.data;
  },

  update: async (id: number, data: UpdateInvoiceDataSourceRequest) => {
    const response = await api.put<{ success: boolean; data: InvoiceDataSource }>(
      `/invoice-data-sources/${id}`,
      data
    );
    return response.data;
  },

  getLogs: async (id: number, options?: { limit?: number; offset?: number } | number) => {
    const limit = typeof options === 'number' ? options : (options?.limit ?? 50);
    const offset = typeof options === 'object' ? (options?.offset ?? 0) : 0;
    const response = await api.get(`/invoice-data-sources/${id}/logs?limit=${limit}&offset=${offset}`);
    return response.data;
  },

  archive: async (id: number) => {
    const response = await api.delete<{ success: boolean }>(`/invoice-data-sources/${id}`);
    return response.data;
  },
};

// Threads API (for comments/notes)
export const threadsApi = {
  list: async (
    params: { entity_type: string; entity_id: string | number; sort?: string; limit?: number },
    _userId?: number // userId not used for listing but kept for API compatibility
  ) => {
    const { entity_type, entity_id, sort, limit } = params;
    const queryParams = new URLSearchParams({
      entity_type,
      entity_id: String(entity_id),
    });
    if (sort) queryParams.set('sort', sort);
    if (limit) queryParams.set('limit', String(limit));
    const response = await api.get(`/threads?${queryParams}`);
    return response.data;
  },

  create: async (
    data: { entity_type: string; entity_id: string | number; content: string },
    userId: number,
    userName: string
  ) => {
    const response = await api.post('/threads', {
      ...data,
      entity_id: Number(data.entity_id),
      author_id: userId,
      author_name: userName,
    });
    return response.data;
  },

  update: async (threadId: number, data: { content: string }, userId: number) => {
    const response = await api.put(`/threads/${threadId}`, {
      ...data,
      author_id: userId,
    });
    return response.data;
  },

  delete: async (threadId: number, userId: number) => {
    const response = await api.delete(`/threads/${threadId}?author_id=${userId}`);
    return response.data;
  },
};

export default api;

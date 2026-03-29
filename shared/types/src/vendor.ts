/**
 * Vendor Types for Logistics Invoice System
 * Types for vendor management CRUD operations
 */

/**
 * Service types offered by vendors
 */
export type VendorService = 'Parcel' | 'LTL' | 'FTL';

/**
 * All available vendor services
 */
export const VENDOR_SERVICES: VendorService[] = ['Parcel', 'LTL', 'FTL'];

/**
 * Payment terms types
 */
export type PaymentTermsType =
  | 'no_due_date'
  | 'based_on_invoice'
  | '14_days'
  | '30_days'
  | 'custom';

/**
 * Display labels for payment terms
 */
export const PAYMENT_TERMS_LABELS: Record<PaymentTermsType, string> = {
  no_due_date: 'No Due Date',
  based_on_invoice: 'Based on Invoice',
  '14_days': '14 Days',
  '30_days': '30 Days',
  custom: 'Custom',
};

/**
 * Vendor record as stored in database
 */
export interface Vendor {
  id: number;
  name: string;
  services: VendorService[] | null;
  payment_terms_type: PaymentTermsType;
  payment_terms_custom_days: number | null;
  invoice_source: string | null;
  shipment_type: string | null;
  vat_info: string | null;
  invoice_frequency: string | null;
  invoice_format: string | null;
  payment_method: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: number | null;
  updated_by: number | null;
}

/**
 * Request body for creating a vendor
 */
export interface CreateVendorRequest {
  name: string;
  services?: VendorService[];
  payment_terms_type?: PaymentTermsType;
  payment_terms_custom_days?: number;
  invoice_source?: string;
  shipment_type?: string;
  vat_info?: string;
  invoice_frequency?: string;
  invoice_format?: string;
  payment_method?: string;
  notes?: string;
  created_by?: number;
}

/**
 * Request body for updating a vendor
 */
export interface UpdateVendorRequest {
  name?: string;
  services?: VendorService[];
  payment_terms_type?: PaymentTermsType;
  payment_terms_custom_days?: number | null;
  invoice_source?: string | null;
  shipment_type?: string | null;
  vat_info?: string | null;
  invoice_frequency?: string | null;
  invoice_format?: string | null;
  payment_method?: string | null;
  notes?: string | null;
  updated_by?: number;
}

/**
 * Response for listing vendors
 */
export interface VendorsListResponse {
  vendors: Vendor[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
}

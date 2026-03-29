"use strict";
/**
 * Invoice Data Source Types
 *
 * Types for the email-based invoice ingestion system.
 * Data sources allow carriers to send invoices to unique email addresses
 * (e.g., ups@invoices.buycycle.com) for automatic OCR processing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INVOICE_DATA_SOURCE_STATUS_LABELS = exports.INVOICE_DATA_SOURCE_STATUSES = void 0;
/**
 * All valid statuses
 */
exports.INVOICE_DATA_SOURCE_STATUSES = [
    'active',
    'paused',
    'archived',
];
/**
 * Display labels for statuses
 */
exports.INVOICE_DATA_SOURCE_STATUS_LABELS = {
    active: 'Active',
    paused: 'Paused',
    archived: 'Archived',
};
//# sourceMappingURL=invoice-data-source.js.map
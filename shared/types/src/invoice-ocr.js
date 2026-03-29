"use strict";
/**
 * Invoice OCR Types
 * Shared types for multi-model invoice OCR extraction with consensus analysis
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWN_LOGISTICS_VENDORS = exports.INVOICE_PAYMENT_METHODS = void 0;
/**
 * All available payment methods
 */
exports.INVOICE_PAYMENT_METHODS = [
    'Mercury',
    'Bank Transfer',
    'PayPal',
    'Credit Card',
    'Direct Debit',
    'Other',
];
/**
 * Known logistics vendors (normalized names)
 */
exports.KNOWN_LOGISTICS_VENDORS = [
    'Wiechert',
    'DS Smith',
    'Hive',
    'Karamac',
    'myGermany',
];
//# sourceMappingURL=invoice-ocr.js.map
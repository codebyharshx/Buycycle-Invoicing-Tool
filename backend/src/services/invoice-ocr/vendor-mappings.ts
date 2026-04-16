/**
 * Vendor-Specific Invoice Field Mappings
 *
 * This file defines how each vendor's invoice terminology maps to our standard database fields.
 * Used by OCR extractors to accurately identify and extract vendor-specific fields.
 */

export interface VendorMapping {
  vendorName: string;
  standardName: string; // Standardized short name for database/UI
  aliases: string[]; // Alternative names that should map to this vendor
  country: string;
  currency: string;
  fieldMappings: {
    documentType: string[];
    netAmount: string[];
    vatAmount: string[];
    grossInvoiceAmount: string[];
    issueDate: string[];
    dueDate: string[];
    performancePeriod: string[];
    invoiceNumber: string[];
    customerNumber?: string[];
    orderNumber?: string[];
    paymentTerms?: string[];
  };
  specialNotes: string[];
  examples: {
    invoiceNumber: string;
    grossAmount: string;
  };
}

/**
 * Standardized vendor names - these are the ONLY names that should be saved to database
 */
export const STANDARD_VENDOR_NAMES = [
  'Wiechert',
  'EasyLox',
  'Horna',
  'Karamac',
  'Mimas',
  'Red Stag',
  'BRT',
  'DS Smith',
  'BikeExchange',
  'Weltweitversenden',
  'S2C',
  'Eurosender',
  'Flowspace',
  'Omnipack',
  'MRW',
  'Sendcloud',
  'UPS',
  'DPD',
  'Cargoboard',
  'DHL',
  'GLS',
  'Hive',
] as const;

export const VENDOR_MAPPINGS: Record<string, VendorMapping> = {
  'paket-ag': {
    vendorName: 'Paket.ag & EasyLox GmbH',
    standardName: 'EasyLox',
    aliases: ['Paket.ag', 'EasyLox GmbH', 'Paket ag', 'EASYLOX', 'Paket.ag & EasyLox GmbH'],
    country: 'Germany',
    currency: 'EUR',
    fieldMappings: {
      documentType: ['Rechnung'],
      netAmount: ['Netto'],
      vatAmount: ['MwSt. 19%', 'MwSt.', 'Mehrwertsteuer'],
      grossInvoiceAmount: ['Gesamt', 'Gesamtbetrag'],
      issueDate: ['Datum', 'Rechnungsdatum'],
      dueDate: ['Fälligkeitsdatum', 'Zahlbar bis'],
      performancePeriod: ['Leistungszeitraum'],
      invoiceNumber: ['Rechnung Nr.', 'Rechnungs-Nr.', 'Invoice Number'],
      customerNumber: ['Kunde Nr.', 'Kunden-Nr.'],
      paymentTerms: ['Zahlungsbedingungen'],
    },
    specialNotes: [
      'Invoice format: "P&E_YYYYnnnnnnn" (e.g., "P&E_20252047597")',
      'Company address: "Mühlweg 3A, 67105 Schifferstadt"',
      'Customer number format: "Kunde Nr.: 32781284"',
      'Auto-debit payment: "Betrag wird in den nächsten Tagen von Ihrem Konto eingezogen"',
      'Performance period explicitly stated: "Leistungszeitraum: DD.MM.YYYY - DD.MM.YYYY"',
      '19% VAT standard rate',
      'Date format: DD.MM.YYYY',
    ],
    examples: {
      invoiceNumber: 'P&E_20252047597',
      grossAmount: '€170.35',
    },
  },

  'karamac': {
    vendorName: 'KARAMAC LOGISTICS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
    standardName: 'Karamac',
    aliases: ['KARAMAC', 'Karamac Logistics', 'KARAMAC LOGISTICS', 'KARAMAC LOGISTICS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ'],
    country: 'Poland',
    currency: 'EUR',
    fieldMappings: {
      documentType: ['FAKTURA / INVOICE', 'FAKTURA', 'Invoice', 'ORYGINAŁ / ORIGINAL', 'ORYGINAŁ', 'ORIGINAL'],
      netAmount: ['Wartość netto / Net value', 'Wartość netto', 'Net value', 'RAZEM / TOTAL'],
      vatAmount: ['Wartość VAT / Tax value', 'Wartość VAT', 'Tax value', 'Stawka VAT / Tax rate'],
      grossInvoiceAmount: ['DO ZAPŁATY / AMOUNT DUE', 'Wartość brutto / Gross value', 'Wartość brutto', 'Gross value', 'DO ZAPŁATY', 'AMOUNT DUE'],
      issueDate: ['Data wystawienia/Invoice date', 'Data wystawienia', 'Invoice date'],
      dueDate: ['Data i sposób płatności / Due in', 'Data i sposób płatności', 'Due in'],
      performancePeriod: ['zał.-rozł.', 'Loading-Unloading dates'],
      invoiceNumber: ['Nr dokumentu/Number', 'Nr dokumentu', 'Number'],
      customerNumber: ['NIP (customer)'],
      paymentTerms: ['14 days', 'PRZELEW'],
    },
    specialNotes: [
      'Invoice format: "Invoice XXX/MM/YY UE" (e.g., "Invoice 005/11/25 UE")',
      'Bilingual labels: Polish / English format throughout',
      'NP = Nie Podlega (VAT exempt/reverse charge)',
      'Odwrotne obciążenie = Reverse charge (VAT = €0.00)',
      'PRZELEW = Bank transfer payment method',
      'Performance period from line item: "zał.-rozł.: DD.MM.YYYY-DD.MM.YYYY"',
      'Date format: DD.MM.YYYY',
      'Bank account labeled "konto/account EUR"',
    ],
    examples: {
      invoiceNumber: 'Invoice 005/11/25 UE',
      grossAmount: '€3,250.00',
    },
  },

  'mimas-technik': {
    vendorName: 'MIMAS TECHNIK',
    standardName: 'Mimas',
    aliases: ['MIMAS TECHNIK', 'Mimas Technik', 'MIMAS'],
    country: 'Poland',
    currency: 'PLN',
    fieldMappings: {
      documentType: ['Invoice FS', 'Faktura Sprzedaży'],
      netAmount: ['Net value', 'Wartość netto'],
      vatAmount: ['Tax value', 'Wartość VAT'],
      grossInvoiceAmount: ['Gross value', 'Total', 'Wartość brutto'],
      issueDate: ['Invoice date', 'Data wystawienia'],
      dueDate: ['due date', 'Termin płatności'],
      performancePeriod: ['Date of supply completion', 'Data wykonania usługi'],
      invoiceNumber: ['Invoice number', 'Numer faktury'],
      orderNumber: ['based on order', 'Zamówienie'],
      paymentTerms: ['45 dni', 'days'],
    },
    specialNotes: [
      'Invoice format: "FS XXX/WT/YYYY" (e.g., "FS 757/WT/2025")',
      'Order reference format: "ZK XXX/WT/YYYY"',
      'szt (sztuk) = pieces (unit of measure)',
      'Niemcy = Germany',
      '0% VAT for international services',
    ],
    examples: {
      invoiceNumber: 'FS 757/WT/2025',
      grossAmount: '20,869.20 PLN',
    },
  },

  'brt': {
    vendorName: 'BRT S.p.A.',
    standardName: 'BRT',
    aliases: ['BRT S.p.A.', 'BRT SpA', 'BRT', 'Sede Operativa ed Amministrativa'],
    country: 'Italy',
    currency: 'EUR',
    fieldMappings: {
      documentType: ['Fattura', 'Tipo documento', 'Invoice', 'Fattura - EUR'],
      netAmount: ['IMPONIBILE', 'Imponibile', 'Net amount'],
      vatAmount: ['IVA', 'Totale IVA', 'VAT', 'BOLLI'],
      grossInvoiceAmount: ['TOTALE FATTURA', 'Total invoice', 'Totale documento', 'Importo'],
      issueDate: ['DATA FATTURA', 'Data', 'Invoice date'],
      dueDate: ['Data scadenza pagamento', 'Payment due date'],
      performancePeriod: ['nel mese di', 'Periodo di competenza', 'RIFERIMENTO DATA'],
      invoiceNumber: ['N. FATTURA', 'Numero Fattura', 'Invoice number'],
      customerNumber: ['CODICE CLIENTE', 'Cod.Cli.Bollettazione'],
      paymentTerms: ['Termini di pagamento (giorni)', 'Payment terms'],
    },
    specialNotes: [
      'Customer number format: "CODICE CLIENTE: 1721465 (172) (996)"',
      'Invoice number format: "N. FATTURA: 674062 (996)" - may have parenthetical reference',
      'BOLLI = Stamp duty (typically €2.00, added separately from VAT)',
      'INVERSIONE CONTABILE ART.7 TER = Reverse charge Article 7 ter',
      'Condizioni di pagamento: TP02 = Full payment, Modalità: MP05 = Bank transfer',
      'Performance period from RIFERIMENTO DATA column (DDMM format) or "nel mese di [Month]"',
      'Date format: DD/MM/YY or DD/MM/YYYY',
    ],
    examples: {
      invoiceNumber: '674062 (996)',
      grossAmount: '€402.88',
    },
  },

  'ds-smith': {
    vendorName: 'DS Smith Polska SP. Z O.O.',
    standardName: 'DS Smith',
    aliases: ['DS Smith Polska', 'DS Smith', 'DSSmith', 'DS SMITH POLSKA SP. Z O.O.'],
    country: 'Poland',
    currency: 'EUR',
    fieldMappings: {
      documentType: ['INVOICE VAT', 'Invoice VAT'],
      netAmount: ['NET AMOUNT', 'Net amount'],
      vatAmount: ['VAT AMOUNT', 'VAT %', 'VAT(PLN)'],
      grossInvoiceAmount: ['TO BE PAID EUR', 'TO BE PAID', 'Amount due', 'TOTAL'],
      issueDate: ['From', 'Invoice date'],
      dueDate: ['Due date', 'Payment due'],
      performancePeriod: ['Date of sale', 'Data sprzedaży'],
      invoiceNumber: ['INVOICE No.', 'Invoice number'],
      orderNumber: ['Order No.', 'Zamówienie'],
      customerNumber: ['Customer No.', 'Customer code', 'Kod klienta'],
      paymentTerms: ['Payment Terms'],
    },
    specialNotes: [
      'Invoice format: "YYDnnnnn" (e.g., "25D02108")',
      '⚠️ CRITICAL: Invoice number is in HEADER with label "INVOICE No." - NOT "Order No."',
      'Customer number format: "Customer No. : 31178"',
      'Gross amount appears as "TO BE PAID EUR: X,XXX.XX"',
      'Delivery note reference: Format "YYnnnnnn - DD/MM/YYYY"',
      'Payment terms: "transfer 30 DAYS NET"',
      '0% VAT for EU reverse charge',
      'Date format: DD/MM/YYYY',
    ],
    examples: {
      invoiceNumber: '25D02108',
      grossAmount: '€3,511.35',
    },
  },

  'bikeexchange': {
    vendorName: 'BikeExchange Inc. / Kitzuma Corp.',
    standardName: 'BikeExchange',
    aliases: ['BikeExchange Inc.', 'Kitzuma Corp.', 'BikeExchange', 'Kitzuma'],
    country: 'USA',
    currency: 'USD',
    fieldMappings: {
      documentType: ['Invoice'],
      netAmount: ['Untaxed Amount', 'Subtotal'],
      vatAmount: ['TAXES', 'Tax'],
      grossInvoiceAmount: ['Total', 'Invoice Total'],
      issueDate: ['Invoice Date'],
      dueDate: ['Due Date'],
      performancePeriod: [],
      invoiceNumber: ['Invoice Number', 'INV'],
      paymentTerms: ['Payment Terms'],
    },
    specialNotes: [
      'American date format: MM/DD/YYYY (e.g., 07/31/2025)',
      'Partial payments shown: "Paid on [date]: $XXX.XX"',
      'Amount Due = Total - Partial Payments',
      'Payment Communication = Invoice number (for bank reference)',
      'No VAT/sales tax typically applied',
      'Payment terms typically 5 days',
    ],
    examples: {
      invoiceNumber: '22837',
      grossAmount: '$3,930.11',
    },
  },

  'weltweitversenden': {
    vendorName: 'weltweitversenden GmbH',
    standardName: 'Weltweitversenden',
    aliases: ['weltweitversenden GmbH', 'weltweitversenden', 'myGermany', 'my Germany'],
    country: 'Germany',
    currency: 'EUR',
    fieldMappings: {
      documentType: ['Shipping Invoice', 'Rechnung'],
      netAmount: ['Net Price', 'Netto'],
      vatAmount: ['VAT 0%', 'MwSt. 0%'],
      grossInvoiceAmount: ['TOTAL Gross Price', 'Gesamtbetrag'],
      issueDate: ['Invoice Date', 'Rechnungsdatum'],
      dueDate: ['Within 7 working days', 'Zahlbar binnen'],
      performancePeriod: ['Service Period', 'Leistungszeitraum'],
      invoiceNumber: ['Invoice Number', 'Rechnungsnummer'],
      customerNumber: ['Customer Number', 'Kundennummer'],
    },
    specialNotes: [
      'Invoice format: "YYYYMMDDnn" (e.g., "2025091006")',
      'MRN = Movement Reference Number (customs export documentation)',
      'Steuerfreie sonstige Leistung gem. § 4 Nr. 3 a) aa) UStG = VAT exempt international transport',
      '0% VAT for cross-border shipping',
      'Due date: "Within 7 working days" from invoice date',
      'Service period format: DD.MM.-DD.MM.YYYY (e.g., 18.08.-23.09.2025)',
    ],
    examples: {
      invoiceNumber: '2025091006',
      grossAmount: '€11,674.32',
    },
  },

  'wiechert': {
    vendorName: 'Wiechert Logistic GmbH',
    standardName: 'Wiechert',
    aliases: ['Wiechert Logistic GmbH', 'Wiechert Logistic', 'Wiechert'],
    country: 'Germany',
    currency: 'EUR',
    fieldMappings: {
      documentType: ['Rechnung / Invoice', 'Rechnung', 'Invoice'],
      netAmount: ['Summe', 'Netto', 'netto'],
      vatAmount: ['Mehrwertsteuer 19%', 'MwSt. 19%', 'Mehrwertsteuer 19% auf'],
      grossInvoiceAmount: ['Gesamtbetrag', 'Total'],
      issueDate: ['Datum', 'Rechnungsdatum'],
      dueDate: ['Zahlungsbedingungen', 'Fälligkeitsdatum', 'zur Zahlung fällig'],
      performancePeriod: ['Leistungsdatum', 'Service date', 'Datum'],
      invoiceNumber: ['Rechnungs-Nr.', 'Invoice Number'],
      customerNumber: ['Kunden-Nr.', 'Customer Number'],
    },
    specialNotes: [
      'Invoice format: "YYYYMMDDnn" (e.g., "2025111810")',
      'Company address: "Rita-Maiburg-Straße 6, DE 88074 Meckenbeuren"',
      'Customer number format: "Kunden-Nr.: 11917"',
      'Net amount shown as "X.XXX,XX € netto"',
      'VAT calculation: "Mehrwertsteuer 19% auf X.XXX,XX € netto: XXX,XX €"',
      'Due date: "Die Rechnung ist am 15. des Folgemonats zur Zahlung fällig" (15th of following month)',
      '19% VAT standard rate for domestic services',
      'Performance period in "Datum" column of line items',
      'Line items reference: "Express Sendungen lt. Anhang" (details in attachment)',
      'Date format: DD.MM.YYYY',
    ],
    examples: {
      invoiceNumber: '2025111810',
      grossAmount: '€3,208.37',
    },
  },

  'redstag': {
    vendorName: 'Red Stag Fulfillment, LLC',
    standardName: 'Red Stag',
    aliases: ['Red Stag Fulfillment, LLC', 'Red Stag Fulfillment', 'RedStag', 'Red Stag'],
    country: 'USA',
    currency: 'USD',
    fieldMappings: {
      documentType: ['Invoice'],
      netAmount: ['Subtotal'],
      vatAmount: [], // No VAT - B2B fulfillment service in USA
      grossInvoiceAmount: ['Amount Due (USD)', 'Total'],
      issueDate: ['Invoice Date'],
      dueDate: [], // No explicit due date - calculated from Payment Terms
      performancePeriod: [], // Inferred from invoice number (YYYY.MM)
      invoiceNumber: ['Invoice #', 'Invoice Number'],
      paymentTerms: ['Payment Terms'], // e.g., "5 Days", "3 Business Days"
    },
    specialNotes: [
      // === GENERAL ===
      'Two invoice types: (1) Fulfillment Invoice (warehouse services), (2) Shipping Invoice (FedEx details)',
      'Invoice number format: "BCL_YYYY.MM" (e.g., "BCL_2026.03")',
      'Company address: 2160 Lakeside Centre Way, Suite 200, Knoxville, TN 37922',
      'No VAT/sales tax (B2B fulfillment service in USA)',
      'American date format: M/DD/YYYY (e.g., 3/31/2026)',
      'All amounts in USD',
      'Due date NOT shown - only Payment Terms (e.g., "5 Days", "3 Business Days")',
      'Due date must be calculated: Invoice Date + Payment Terms days',
      'Performance period inferred from invoice number month (YYYY.MM)',

      // === FULFILLMENT INVOICE (PDF only) ===
      'FULFILLMENT INVOICE: PDF only, no XLSX detail file',
      'Fulfillment invoice filename pattern: fulfillment_invoice_bcl_YYYY_MM.pdf',
      'Document type should be: fulfillment_invoice',
      'Line items grouped by warehouse location (e.g., "Salt Lake City, UT (SLC2)", "Sweetwater, TN (SWT1)")',
      'Line item columns: Category, Service, Quantity, Rate, Amount',
      'Service categories: Storage (Cubic Storage), Inbound (Barcoding, Pallet Receiving), Outbound (Package Fulfillment), Kitting, Other (Retrievals, Reroutes)',
      'Subtotals per warehouse location, final total at end',

      // === SHIPPING INVOICE (PDF + XLSX) ===
      'SHIPPING INVOICE: PDF header + XLSX detail file with FedEx shipments',
      'Shipping invoice filename pattern: shipping_invoice_bcl_YYYY_MM_N.pdf + *_client_detail.xlsx',
      'Document type should be: shipping_invoice',
      'XLSX sheet name: "FedEx"',
      'XLSX structure: Row 1 = aggregated data (skip), Row 2 = headers, Row 3+ = data',
      'XLSX columns: Tracking ID, Service Type, Shipment Date (YYYYMMDD), Order #, Order Reference, Weight, Pieces, Recipient details, Surcharges, Total Charges',
      'Shipment date format in XLSX: YYYYMMDD (e.g., 20260310)',
      'Services: Ground, Home Delivery',
      'Surcharges: Fuel Surcharge, DAS (Delivery Area Surcharge), Residential, Oversize, Address Correction, etc.',
    ],
    examples: {
      invoiceNumber: 'BCL_2026.03',
      grossAmount: '$2,616.84',
    },
  },

  'dhl': {
    vendorName: 'DHL Express',
    standardName: 'DHL',
    aliases: [
      'DHL', 'DHL Express', 'DHL Express Germany GmbH', 'DHL Express Germany',
      'DHL Germany', 'Deutsche Post DHL', 'Deutsche Post DHL Group',
      'DHL Express (Germany) GmbH', 'DHL Paket', 'DHL Paket GmbH',
      'DHL Express GmbH', 'DHL International GmbH',
    ],
    country: 'Germany',
    currency: 'EUR',
    fieldMappings: {
      documentType: ['Invoice', 'Rechnung'],
      netAmount: ['Net Amount', 'Nettobetrag', 'Total amount (excl. VAT)'],
      vatAmount: ['VAT', 'MwSt.', 'Mehrwertsteuer', 'Total Tax'],
      grossInvoiceAmount: ['Total', 'Gesamtbetrag', 'Total amount (incl. VAT)'],
      issueDate: ['Invoice Date', 'Rechnungsdatum', 'Date'],
      dueDate: ['Due Date', 'Fälligkeitsdatum', 'Payment Due'],
      performancePeriod: ['Service Period', 'Leistungszeitraum'],
      invoiceNumber: ['Invoice Number', 'Rechnungsnummer', 'Invoice No.'],
      customerNumber: ['Account Number', 'Kundennummer', 'Customer No.'],
    },
    specialNotes: [
      'DHL invoices often come with CSV line item details',
      'CSV format: RAW (155 columns) or Template (39 columns)',
      'Multiple shipments per invoice with individual tracking numbers',
      'Extra charges (XC1-XC9) for fuel surcharges, customs, etc.',
    ],
    examples: {
      invoiceNumber: 'MUCIR00169682',
      grossAmount: '€5,275.29',
    },
  },

  'ups': {
    vendorName: 'UPS (United Parcel Service)',
    standardName: 'UPS',
    aliases: [
      'UPS', 'United Parcel Service', 'UPS Deutschland',
      'UPS Germany', 'UPS Europe', 'UPS Express',
    ],
    country: 'USA',
    currency: 'EUR',
    fieldMappings: {
      documentType: ['Invoice'],
      netAmount: ['Net Amount', 'Subtotal'],
      vatAmount: ['VAT', 'Tax'],
      grossInvoiceAmount: ['Total', 'Amount Due'],
      issueDate: ['Invoice Date'],
      dueDate: ['Due Date', 'Payment Due'],
      performancePeriod: [],
      invoiceNumber: ['Invoice Number', 'Invoice No.'],
      customerNumber: ['Account Number'],
    },
    specialNotes: [
      'UPS invoices often come with CSV line item details',
      'CSV has Shipment/Surcharge/Adjustment record types',
      'American date format: Month DD, YYYY',
      'Tracking numbers start with 1Z',
    ],
    examples: {
      invoiceNumber: '0000F12345678',
      grossAmount: '$1,234.56',
    },
  },

  'gls': {
    vendorName: 'GLS (General Logistics Systems)',
    standardName: 'GLS',
    aliases: ['GLS', 'GLS Germany', 'GLS Parcel', 'General Logistics Systems', 'GLS Group'],
    country: 'Germany',
    currency: 'EUR',
    fieldMappings: {
      documentType: ['Invoice', 'Rechnung'],
      netAmount: ['Net Amount', 'Netto'],
      vatAmount: ['VAT', 'MwSt.'],
      grossInvoiceAmount: ['Total', 'Gesamt'],
      issueDate: ['Invoice Date', 'Rechnungsdatum'],
      dueDate: ['Due Date', 'Fälligkeitsdatum'],
      performancePeriod: [],
      invoiceNumber: ['Invoice Number', 'Document No.'],
    },
    specialNotes: [
      'GLS invoices require CSV for line item details',
      'CSV has Gepard Customer ID and Parcel Number columns',
    ],
    examples: {
      invoiceNumber: '123456789',
      grossAmount: '€500.00',
    },
  },

  'hive': {
    vendorName: 'Hive Logistics',
    standardName: 'Hive',
    aliases: ['Hive', 'Hive Logistics', 'HIVE', 'Hive Fulfillment'],
    country: 'Germany',
    currency: 'EUR',
    fieldMappings: {
      documentType: ['Invoice'],
      netAmount: ['Net Amount'],
      vatAmount: ['VAT'],
      grossInvoiceAmount: ['Total'],
      issueDate: ['Invoice Date'],
      dueDate: ['Due Date'],
      performancePeriod: [],
      invoiceNumber: ['Invoice Number'],
    },
    specialNotes: [
      'Hive invoices require CSV for line item details',
      'CSV has Shipment Reference, Shop Order ID, Hive Order ID columns',
    ],
    examples: {
      invoiceNumber: 'INV-12345',
      grossAmount: '€750.00',
    },
  },

  'mrw': {
    vendorName: 'MRW (Motoroads World)',
    standardName: 'MRW',
    aliases: [
      'MRW', 'VALENCIA VALENCIA', 'Valencia Valencia',
      'Motoroads World', 'MRW Spain', 'MRW Transporte',
    ],
    country: 'Spain',
    currency: 'EUR',
    fieldMappings: {
      documentType: ['Factura', 'Invoice'],
      netAmount: ['Base Imponible', 'Net Amount'],
      vatAmount: ['IVA', 'VAT'],
      grossInvoiceAmount: ['Total Factura', 'Total'],
      issueDate: ['Fecha Factura', 'Invoice Date'],
      dueDate: ['Fecha Vencimiento', 'Due Date'],
      performancePeriod: ['Periodo de Servicio'],
      invoiceNumber: ['Nº Factura', 'Invoice Number'],
      customerNumber: ['Código Cliente', 'Customer Code'],
    },
    specialNotes: [
      'MRW is a Spanish courier/logistics company',
      'May appear as "VALENCIA VALENCIA" in some invoice systems',
      'Spanish date format: DD/MM/YYYY',
      '21% IVA (VAT) standard rate in Spain',
    ],
    examples: {
      invoiceNumber: 'BB0013275',
      grossAmount: '€500.00',
    },
  },

  'sport-events': {
    vendorName: 'SPORT & EVENTS LOGISTICS SRL Società Benefit',
    standardName: 'S2C',
    aliases: [
      'SPORT & EVENTS LOGISTICS SRL',
      'SPORT & EVENTS LOGISTICS',
      'Sport & Events Logistics',
      'Sport Events Logistics',
      'Sport & Events',
      'Società Benefit',
      'S2C',
    ],
    country: 'Italy',
    currency: 'EUR',
    fieldMappings: {
      documentType: ['INVOICE', 'Document Type', 'ORIGINALE'],
      netAmount: ['Total', 'Amount'],
      vatAmount: ['Vat Amount', 'IVA'],
      grossInvoiceAmount: ['Document Total', 'EURO'],
      issueDate: ['Date'],
      dueDate: ['Paymenti Terms', 'Payment Terms'],
      performancePeriod: [],
      invoiceNumber: ['Nr.document', 'Document Number'],
      customerNumber: ['ORIGINALE'],
    },
    specialNotes: [
      'Invoice format: "YYYY / NNNNNN / VE" (e.g., "2025 / 000516 / VE")',
      'Company address: "IT-10124 Moncalieri (TO) Via Bruno Buozzi, 28"',
      'Customer code appears after "ORIGINALE" label (e.g., "ORIGINALE 3338")',
      'Document Type field explicitly labeled as "Document Type: INVOICE"',
      'Currency shown as "Curren: EURO"',
      'VAT Code 7 = Art. 7-ter Reverse Charge (0% VAT)',
      'Payment terms: "IMMEDIATE PAYMENT" or similar',
      'Performance period often inferred from line item description (e.g., "11_2025" = Nov 2025)',
      'Date format: DD/MM/YYYY',
    ],
    examples: {
      invoiceNumber: '2025 / 000516 / VE',
      grossAmount: '€1,835.22',
    },
  },
};

/**
 * Get vendor mapping by vendor name (case-insensitive, partial match)
 */
export function getVendorMapping(vendorName: string): VendorMapping | null {
  const normalizedVendor = vendorName.toLowerCase().trim();

  // Direct key match
  const directMatch = VENDOR_MAPPINGS[normalizedVendor];
  if (directMatch) return directMatch;

  // Partial match on vendor name
  for (const [key, mapping] of Object.entries(VENDOR_MAPPINGS)) {
    const mappingNameLower = mapping.vendorName.toLowerCase();
    if (
      normalizedVendor.includes(key) ||
      mappingNameLower.includes(normalizedVendor) ||
      normalizedVendor.includes(mappingNameLower.split(' ')[0]) // Match first word
    ) {
      return mapping;
    }
  }

  return null;
}

/**
 * Get all vendor names for vendor detection
 */
export function getAllVendorNames(): string[] {
  return Object.values(VENDOR_MAPPINGS).map(m => m.vendorName);
}

/**
 * Get vendor-specific extraction hints for prompts
 */
export function getVendorExtractionHints(vendorName: string): string {
  const mapping = getVendorMapping(vendorName);
  if (!mapping) return '';

  const hints: string[] = [
    `**${mapping.vendorName}** (${mapping.country}) - ${mapping.currency}`,
    '',
    '**Field Locations:**',
  ];

  // Add field mappings
  if (mapping.fieldMappings.invoiceNumber.length > 0) {
    hints.push(
      `- Invoice Number: Look for "${mapping.fieldMappings.invoiceNumber.join('", "')}" (Example: ${mapping.examples.invoiceNumber})`
    );
  }
  if (mapping.fieldMappings.grossInvoiceAmount.length > 0) {
    hints.push(
      `- Gross Amount: Look for "${mapping.fieldMappings.grossInvoiceAmount.join('", "')}" (Example: ${mapping.examples.grossAmount})`
    );
  }
  if (mapping.fieldMappings.netAmount.length > 0) {
    hints.push(`- Net Amount: Look for "${mapping.fieldMappings.netAmount.join('", "')}"`);
  }
  if (mapping.fieldMappings.vatAmount.length > 0) {
    hints.push(`- VAT Amount: Look for "${mapping.fieldMappings.vatAmount.join('", "')}"`);
  }
  if (mapping.fieldMappings.issueDate.length > 0) {
    hints.push(`- Issue Date: Look for "${mapping.fieldMappings.issueDate.join('", "')}"`);
  }
  if (mapping.fieldMappings.dueDate.length > 0) {
    hints.push(`- Due Date: Look for "${mapping.fieldMappings.dueDate.join('", "')}"`);
  }

  // Add special notes
  if (mapping.specialNotes.length > 0) {
    hints.push('', '**Special Notes:**');
    mapping.specialNotes.forEach(note => hints.push(`- ${note}`));
  }

  return hints.join('\n');
}

/**
 * Normalize vendor name to standard format
 * Converts various OCR-extracted vendor names to standardized database names
 *
 * Priority order:
 * 1. Exact match against STANDARD_VENDOR_NAMES (case-insensitive)
 * 2. Exact match against vendor aliases
 * 3. Standard name contained in extracted vendor
 * 4. Partial match against aliases
 * 5. Hardcoded fallback patterns
 *
 * @param extractedVendor - Vendor name extracted by OCR (may be full company name)
 * @returns Standardized vendor name for database/UI, or original if no match found
 *
 * @example
 * normalizeVendorName('KARAMAC LOGISTICS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ') → 'Karamac'
 * normalizeVendorName('Wiechert Logistic GmbH') → 'Wiechert'
 * normalizeVendorName('DHL Express Germany GmbH') → 'DHL'
 */
export function normalizeVendorName(extractedVendor: string): string {
  if (!extractedVendor || extractedVendor.trim() === '') {
    return extractedVendor;
  }

  const normalized = extractedVendor.toLowerCase().trim();

  // Priority 1: Check if extracted name exactly matches a standard vendor name
  for (const standardName of STANDARD_VENDOR_NAMES) {
    if (standardName.toLowerCase() === normalized) {
      return standardName;
    }
  }

  // Priority 2: Check if extracted name exactly matches any alias (case-insensitive)
  for (const mapping of Object.values(VENDOR_MAPPINGS)) {
    // Check exact match against vendorName
    if (mapping.vendorName.toLowerCase() === normalized) {
      return mapping.standardName;
    }

    // Check exact match against aliases
    for (const alias of mapping.aliases) {
      if (alias.toLowerCase() === normalized) {
        return mapping.standardName;
      }
    }
  }

  // Priority 3: Check if extracted name CONTAINS a standard vendor name
  // This catches cases like "DHL Express Germany GmbH" containing "DHL"
  // Process longer names first to avoid false matches (e.g., "DS" before "DS Smith")
  const sortedStandardNames = [...STANDARD_VENDOR_NAMES].sort((a, b) => b.length - a.length);
  for (const standardName of sortedStandardNames) {
    // Use word boundary matching to avoid partial matches like "DHLS"
    const regex = new RegExp(`\\b${standardName.toLowerCase()}\\b`);
    if (regex.test(normalized)) {
      return standardName;
    }
  }

  // Priority 4: Check if extracted name contains any alias (partial match)
  for (const mapping of Object.values(VENDOR_MAPPINGS)) {
    // Check if any alias is contained in extracted name
    for (const alias of mapping.aliases) {
      const aliasLower = alias.toLowerCase();
      // Only match if alias is at least 4 chars (avoid false positives)
      if (aliasLower.length >= 4 && normalized.includes(aliasLower)) {
        return mapping.standardName;
      }
    }

    // Check if extracted name contains the standard name (word boundary)
    const standardRegex = new RegExp(`\\b${mapping.standardName.toLowerCase()}\\b`);
    if (standardRegex.test(normalized)) {
      return mapping.standardName;
    }
  }

  // Priority 5: Hardcoded fallback patterns for common variations
  // These are checked with word boundaries to avoid false matches
  const hardcodedPatterns: Array<{ pattern: RegExp; standardName: string }> = [
    { pattern: /\bdhl\b/, standardName: 'DHL' },
    { pattern: /\bups\b/, standardName: 'UPS' },
    { pattern: /\bdpd\b/, standardName: 'DPD' },
    { pattern: /\bmrw\b/, standardName: 'MRW' },
    { pattern: /\bvalencia\s+valencia\b/, standardName: 'MRW' },
    { pattern: /\bgls\b/, standardName: 'GLS' },
    { pattern: /\bsendcloud\b/, standardName: 'Sendcloud' },
    { pattern: /\beurosender\b/, standardName: 'Eurosender' },
    { pattern: /\bhive\b/, standardName: 'Hive' },
    { pattern: /\bflowspace\b/, standardName: 'Flowspace' },
    { pattern: /\bomnipack\b/, standardName: 'Omnipack' },
    { pattern: /\bcargoboard\b/, standardName: 'Cargoboard' },
    { pattern: /\bs2c\b/, standardName: 'S2C' },
    { pattern: /\bhorna\b/, standardName: 'Horna' },
    { pattern: /\bwiechert\b/, standardName: 'Wiechert' },
    { pattern: /\bkaramac\b/, standardName: 'Karamac' },
    { pattern: /\bds\s*smith\b/, standardName: 'DS Smith' },
    { pattern: /\bbrt\b/, standardName: 'BRT' },
    { pattern: /\bmimas\b/, standardName: 'Mimas' },
    { pattern: /\beasylox\b/, standardName: 'EasyLox' },
    { pattern: /\bpaket\.?ag\b/, standardName: 'EasyLox' },
    { pattern: /\bred\s*stag\b/, standardName: 'Red Stag' },
    { pattern: /\bbikeexchange\b/, standardName: 'BikeExchange' },
    { pattern: /\bkitzuma\b/, standardName: 'BikeExchange' },
    { pattern: /\bweltweitversenden\b/, standardName: 'Weltweitversenden' },
    { pattern: /\bmygermany\b/, standardName: 'Weltweitversenden' },
    { pattern: /\bsport\s*[&]?\s*events\b/, standardName: 'S2C' },
    { pattern: /\bsocietà\s*benefit\b/, standardName: 'S2C' },
  ];

  for (const { pattern, standardName } of hardcodedPatterns) {
    if (pattern.test(normalized)) {
      return standardName;
    }
  }

  // If no match found, return original with first letter capitalized
  return extractedVendor.charAt(0).toUpperCase() + extractedVendor.slice(1);
}

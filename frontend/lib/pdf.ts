/**
 * PDF utilities
 */

/**
 * Build a URL for viewing a PDF file
 */
export function buildPdfViewerUrl(fileId: number | string): string {
  return `/api/invoice-ocr/file/${fileId}`;
}

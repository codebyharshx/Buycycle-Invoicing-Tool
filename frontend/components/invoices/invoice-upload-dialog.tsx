'use client';

/**
 * Invoice Upload Dialog
 * Allows users to upload invoices for OCR extraction
 * Supports both single-file (Non-Line Items) and multi-file (Line Items with CSV)
 */

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoicesApi } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Upload, Loader2, FileText, CheckCircle, AlertCircle, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface InvoiceUploadDialogProps {
  trigger?: React.ReactNode;
}

type InvoiceType = 'non-line-items' | 'line-items';

export function InvoiceUploadDialog({ trigger }: InvoiceUploadDialogProps) {
  const [open, setOpen] = useState(false);
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('non-line-items');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();

  // Single file upload mutation (Non-Line Items)
  const uploadMutation = useMutation({
    mutationFn: (data: { file: File; notes?: string }) =>
      invoicesApi.upload(data.file, {
        models: ['deepseek', 'mistral', 'gemini'],
        created_via: 'frontend',
        notes: data.notes || undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (data.warning) {
        toast.warning('Invoice uploaded with warnings', {
          description: data.warning,
          duration: 5000,
        });
      } else {
        toast.success('Invoice uploaded successfully');
      }
      router.push(`/dashboard/invoices/${data.id}`);
      setOpen(false);
      resetForm();
    },
  });

  // Multi-file upload mutation (Line Items)
  const uploadWithLineItemsMutation = useMutation({
    mutationFn: (data: { pdfFile: File; csvFile: File; notes?: string }) =>
      invoicesApi.uploadWithLineItems(data.pdfFile, data.csvFile, {
        models: ['deepseek', 'mistral', 'gemini'],
        created_via: 'frontend',
        notes: data.notes || undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (data.warning) {
        toast.warning('Invoice uploaded with warnings', {
          description: data.warning,
          duration: 5000,
        });
      } else {
        toast.success('Invoice uploaded successfully');
      }
      router.push(`/dashboard/invoices/${data.id}`);
      setOpen(false);
      resetForm();
    },
  });

  const resetForm = () => {
    setPdfFile(null);
    setCsvFile(null);
    setNotes('');
    setInvoiceType('non-line-items');
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, fileType: 'pdf' | 'csv') => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0], fileType);
    }
  }, []);

  const handleFileSelect = (selectedFile: File, fileType: 'pdf' | 'csv') => {
    if (fileType === 'pdf') {
      // Validate PDF file type
      const validTypes = ['application/pdf', 'image/png', 'image/jpeg'];
      if (!validTypes.includes(selectedFile.type)) {
        toast.error('Please upload a PDF, PNG, or JPG file');
        return;
      }

      // Validate file size (50MB max)
      const maxSize = 50 * 1024 * 1024;
      if (selectedFile.size > maxSize) {
        toast.error('File size must be less than 50MB');
        return;
      }

      setPdfFile(selectedFile);
    } else {
      // Validate CSV file
      if (!selectedFile.name.endsWith('.csv')) {
        toast.error('Please upload a CSV file');
        return;
      }

      // Validate file size (10MB max for CSV)
      const maxSize = 10 * 1024 * 1024;
      if (selectedFile.size > maxSize) {
        toast.error('CSV file size must be less than 10MB');
        return;
      }

      setCsvFile(selectedFile);
    }
  };

  const handleSubmit = () => {
    if (invoiceType === 'non-line-items') {
      if (!pdfFile) return;
      uploadMutation.mutate({ file: pdfFile, notes });
    } else {
      if (!pdfFile || !csvFile) return;
      uploadWithLineItemsMutation.mutate({ pdfFile, csvFile, notes });
    }
  };

  const isUploading = uploadMutation.isPending || uploadWithLineItemsMutation.isPending;
  const uploadError = uploadMutation.error || uploadWithLineItemsMutation.error;
  const uploadSuccess = uploadMutation.isSuccess || uploadWithLineItemsMutation.isSuccess;
  const uploadData = uploadMutation.data || uploadWithLineItemsMutation.data;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Upload className="h-4 w-4 mr-2" />
            Upload Invoice
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Upload Invoice for OCR Extraction</DialogTitle>
          <DialogDescription>
            Upload invoices with or without detailed line items (e.g., DHL invoices with CSV data).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Invoice Type Selector */}
          <div className="space-y-2">
            <Label htmlFor="invoice-type">Invoice Type</Label>
            <Select value={invoiceType} onValueChange={(value) => setInvoiceType(value as InvoiceType)}>
              <SelectTrigger id="invoice-type">
                <SelectValue placeholder="Select invoice type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="non-line-items">Non-Line Items (Single PDF/Image)</SelectItem>
                <SelectItem value="line-items">Line Items (PDF + CSV)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {invoiceType === 'non-line-items'
                ? 'Standard invoice without detailed line-by-line breakdown'
                : 'Multi-line invoice (e.g., DHL) with detailed CSV containing shipment data'}
            </p>
          </div>

          {/* PDF File Upload */}
          <div className="space-y-2">
            <Label>Invoice {invoiceType === 'line-items' && 'PDF'}</Label>
            <div
              className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                dragActive ? 'border-blue-400 bg-blue-50/60' : 'border-gray-200'
              } ${pdfFile ? 'bg-gray-50' : 'bg-white'}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={(e) => handleDrop(e, 'pdf')}
            >
              {!pdfFile ? (
                <div className="flex flex-col items-center justify-center py-4">
                  <Upload className="h-10 w-10 text-gray-400" />
                  <div className="mt-3">
                    <Label htmlFor="pdf-upload" className="cursor-pointer">
                      <span className="text-blue-600 hover:text-blue-500 font-medium">
                        Click to upload
                      </span>
                      <span className="text-gray-600"> or drag and drop</span>
                    </Label>
                    <input
                      id="pdf-upload"
                      type="file"
                      className="sr-only"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleFileSelect(e.target.files[0], 'pdf');
                        }
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">PDF, PNG, or JPG (max 50MB)</p>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <FileText className="h-6 w-6 text-blue-600" />
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-900">{pdfFile.name}</p>
                      <p className="text-xs text-gray-500">
                        {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPdfFile(null)}
                    disabled={isUploading}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* CSV File Upload (only for line items) */}
          {invoiceType === 'line-items' && (
            <div className="space-y-2">
              <Label>CSV File with Line Items</Label>
              <div
                className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  dragActive ? 'border-blue-400 bg-blue-50/60' : 'border-gray-200'
                } ${csvFile ? 'bg-gray-50' : 'bg-white'}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={(e) => handleDrop(e, 'csv')}
              >
                {!csvFile ? (
                  <div className="flex flex-col items-center justify-center py-4">
                    <Upload className="h-10 w-10 text-gray-400" />
                    <div className="mt-3">
                      <Label htmlFor="csv-upload" className="cursor-pointer">
                        <span className="text-blue-600 hover:text-blue-500 font-medium">
                          Click to upload
                        </span>
                        <span className="text-gray-600"> or drag and drop</span>
                      </Label>
                      <input
                        id="csv-upload"
                        type="file"
                        className="sr-only"
                        accept=".csv"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleFileSelect(e.target.files[0], 'csv');
                          }
                        }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-2">CSV file (max 10MB)</p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <FileText className="h-6 w-6 text-green-600" />
                      <div className="text-left">
                        <p className="text-sm font-medium text-gray-900">{csvFile.name}</p>
                        <p className="text-xs text-gray-500">
                          {(csvFile.size / 1024).toFixed(2)} KB
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCsvFile(null)}
                      disabled={isUploading}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add any notes about this invoice..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isUploading}
              rows={3}
            />
          </div>

          {/* OCR Models Info */}
          <Alert>
            <AlertDescription className="text-xs">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-xs rounded-full px-2.5 py-0.5">DeepSeek OCR</Badge>
                <Badge variant="outline" className="text-xs rounded-full px-2.5 py-0.5">Mistral OCR</Badge>
                <Badge variant="outline" className="text-xs rounded-full px-2.5 py-0.5">Gemini 2.5 Pro</Badge>
              </div>
              Smart fallback with 90% confidence threshold for fast, accurate extraction
            </AlertDescription>
          </Alert>

          {/* Upload Status */}
          {isUploading && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>
                Extracting invoice data{invoiceType === 'line-items' && ' and parsing line items'}... This may take 10-30 seconds.
              </AlertDescription>
            </Alert>
          )}

          {uploadError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {uploadError instanceof Error
                  ? uploadError.message
                  : 'Failed to upload invoice. Please try again.'}
              </AlertDescription>
            </Alert>
          )}

          {uploadSuccess && uploadData && (
            <Alert>
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription>
                Invoice extracted successfully! Confidence:{' '}
                {uploadData.extraction.analysis.confidence_score.toFixed(1)}%
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isUploading ||
              !pdfFile ||
              (invoiceType === 'line-items' && !csvFile)
            }
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload & Extract
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

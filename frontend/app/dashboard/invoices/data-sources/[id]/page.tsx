'use client';

/**
 * Data Source Detail Page
 * View and manage a single email data source
 */

import { useState, useEffect, use } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { dataSourcesApi, type UpdateInvoiceDataSourceRequest } from '@/lib/api';
import { DataSourceLogs } from '@/components/invoices/data-source-logs';
import { DataSourceModal } from '@/components/invoices/data-source-modal';
import { usePageHeader } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  Edit,
  Mail,
  FileText,
  Clock,
  CheckCircle2,
  Settings,
  Copy,
  Check,
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function DataSourceDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const dataSourceId = parseInt(resolvedParams.id, 10);

  const { setHeader } = usePageHeader();
  const queryClient = useQueryClient();

  // State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [logsPage, setLogsPage] = useState(1);
  const [logsLimit] = useState(20);
  const [copiedEmail, setCopiedEmail] = useState(false);

  // Fetch data source
  const {
    data: dataSource,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['invoice-data-source', dataSourceId],
    queryFn: () => dataSourcesApi.get(dataSourceId),
    enabled: !isNaN(dataSourceId),
  });

  // Fetch logs
  const {
    data: logsData,
    isLoading: isLoadingLogs,
  } = useQuery({
    queryKey: ['invoice-data-source-logs', dataSourceId, logsPage, logsLimit],
    queryFn: () =>
      dataSourcesApi.getLogs(dataSourceId, {
        limit: logsLimit,
        offset: (logsPage - 1) * logsLimit,
      }),
    enabled: !isNaN(dataSourceId),
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: UpdateInvoiceDataSourceRequest) =>
      dataSourcesApi.update(dataSourceId, data),
    onSuccess: (ds) => {
      queryClient.invalidateQueries({ queryKey: ['invoice-data-source', dataSourceId] });
      queryClient.invalidateQueries({ queryKey: ['invoice-data-sources'] });
      toast.success(`Data source "${ds.name}" updated`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update data source');
    },
  });

  // Set page header
  useEffect(() => {
    if (dataSource) {
      setHeader({ title: dataSource.name });
    }
  }, [dataSource, setHeader]);

  // Copy email to clipboard
  const handleCopyEmail = async () => {
    if (dataSource) {
      await navigator.clipboard.writeText(dataSource.email_address);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    }
  };

  const handleLogsPageChange = (offset: number) => {
    setLogsPage(Math.floor(offset / logsLimit) + 1);
  };

  const handleSave = async (data: UpdateInvoiceDataSourceRequest) => {
    await updateMutation.mutateAsync(data);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  // Error state
  if (error || !dataSource) {
    return (
      <div className="p-6">
        <Link href="/dashboard/invoices/data-sources">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Data Sources
          </Button>
        </Link>
        <div className="text-red-500 bg-red-50 p-4 rounded">
          {error instanceof Error ? error.message : 'Data source not found'}
        </div>
      </div>
    );
  }

  // Get status badge
  const getStatusBadge = () => {
    switch (dataSource.status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800">Active</Badge>;
      case 'paused':
        return <Badge className="bg-yellow-100 text-yellow-800">Paused</Badge>;
      case 'archived':
        return <Badge className="bg-gray-100 text-gray-600">Archived</Badge>;
      default:
        return <Badge variant="outline">{dataSource.status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/invoices/data-sources">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{dataSource.name}</h1>
              {getStatusBadge()}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <code className="text-sm bg-gray-100 px-2 py-0.5 rounded">
                {dataSource.email_address}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleCopyEmail}
              >
                {copiedEmail ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          <Edit className="h-4 w-4 mr-1" />
          Edit
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Emails Received
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {dataSource.total_emails_received.toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Invoices Processed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {dataSource.total_invoices_processed.toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Last Received
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-medium">
              {dataSource.last_received_at
                ? format(new Date(dataSource.last_received_at), 'MMM d, yyyy')
                : 'Never'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Auto-Process
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-medium">
              {dataSource.auto_process ? 'Enabled' : 'Disabled'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="logs" className="w-full">
        <TabsList>
          <TabsTrigger value="logs" className="flex items-center gap-1">
            <FileText className="h-4 w-4" />
            Activity Logs
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-1">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="logs" className="mt-4">
          <DataSourceLogs
            logs={logsData?.logs || []}
            isLoading={isLoadingLogs}
            pagination={logsData?.pagination}
            onPageChange={handleLogsPageChange}
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">Email Address</label>
                  <p className="mt-1 font-mono">{dataSource.email_address}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Status</label>
                  <p className="mt-1">{getStatusBadge()}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Vendor Hint</label>
                  <p className="mt-1">
                    {dataSource.vendor_hint || <span className="text-gray-400">Not set</span>}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Auto-Process</label>
                  <p className="mt-1">{dataSource.auto_process ? 'Enabled' : 'Disabled'}</p>
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-500">Description</label>
                  <p className="mt-1">
                    {dataSource.description || <span className="text-gray-400">No description</span>}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Created</label>
                  <p className="mt-1">
                    {format(new Date(dataSource.created_at), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Last Updated</label>
                  <p className="mt-1">
                    {format(new Date(dataSource.updated_at), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Modal */}
      <DataSourceModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        dataSource={dataSource}
        onSave={handleSave}
      />
    </div>
  );
}

'use client';

/**
 * Scheduler Status Component
 * Shows the status of automated invoice fetching jobs
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { dataSourcesApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Clock,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Calendar,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

export function SchedulerStatus() {
  const queryClient = useQueryClient();

  // Fetch scheduler status
  const {
    data: status,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['scheduler-status'],
    queryFn: () => dataSourcesApi.getSchedulerStatus(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Trigger job mutation
  const triggerMutation = useMutation({
    mutationFn: (jobId: string) => dataSourcesApi.triggerJob(jobId),
    onSuccess: (result) => {
      if (result.success) {
        toast.success(result.message);
        queryClient.invalidateQueries({ queryKey: ['scheduler-status'] });
      } else {
        toast.error(result.message);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to trigger job');
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-red-500">
            Failed to load scheduler status
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Auto-Fetch Scheduler
            </CardTitle>
            <CardDescription>
              Automated jobs that fetch invoices from configured sources
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {status?.initialized ? (
              <Badge className="bg-green-100 text-green-800">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Running
              </Badge>
            ) : (
              <Badge className="bg-gray-100 text-gray-600">
                <XCircle className="h-3 w-3 mr-1" />
                Stopped
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {status?.jobs && status.jobs.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Interval</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Next Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">{job.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      Every {job.interval} min
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">
                    {job.lastRun
                      ? formatDistanceToNow(new Date(job.lastRun), { addSuffix: true })
                      : 'Never'}
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">
                    {job.nextRun ? (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(job.nextRun), 'HH:mm')}
                      </span>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    {job.isRunning ? (
                      <Badge className="bg-blue-100 text-blue-800">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Running
                      </Badge>
                    ) : (
                      <Badge variant="outline">Idle</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => triggerMutation.mutate(job.id)}
                      disabled={triggerMutation.isPending || job.isRunning}
                    >
                      {triggerMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Clock className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="font-medium">No scheduled jobs</p>
            <p className="text-sm mt-1">
              Configure IMAP or SFTP connection in environment variables to enable automatic fetching.
            </p>
          </div>
        )}

        {/* Environment Variables Hint */}
        <div className="mt-6 p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
          <p className="font-medium mb-2">Configure via Environment Variables:</p>
          <div className="grid grid-cols-2 gap-4 font-mono text-xs">
            <div>
              <p className="text-gray-500 mb-1">IMAP (Email)</p>
              <code className="block">INVOICE_IMAP_HOST</code>
              <code className="block">INVOICE_IMAP_PORT</code>
              <code className="block">INVOICE_IMAP_USER</code>
              <code className="block">INVOICE_IMAP_PASSWORD</code>
              <code className="block">INVOICE_IMAP_POLL_INTERVAL</code>
            </div>
            <div>
              <p className="text-gray-500 mb-1">SFTP</p>
              <code className="block">INVOICE_SFTP_HOST</code>
              <code className="block">INVOICE_SFTP_PORT</code>
              <code className="block">INVOICE_SFTP_USER</code>
              <code className="block">INVOICE_SFTP_PASSWORD</code>
              <code className="block">INVOICE_SFTP_POLL_INTERVAL</code>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

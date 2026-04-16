'use client';

/**
 * Data Source Connection Component
 * Configure IMAP/SFTP connection settings and test/fetch functionality
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  dataSourcesApi,
  type ImapConfig,
  type SftpConfig,
} from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Mail,
  Server,
  CheckCircle2,
  XCircle,
  Play,
  RefreshCw,
  FolderOpen,
  Lock,
} from 'lucide-react';

interface DataSourceConnectionProps {
  dataSourceId: number;
  dataSourceName: string;
  onFetchComplete?: (extractionIds: number[]) => void;
}

type ConnectionType = 'imap' | 'sftp';

export function DataSourceConnection({
  dataSourceId,
  dataSourceName,
  onFetchComplete,
}: DataSourceConnectionProps) {
  // Connection type
  const [connectionType, setConnectionType] = useState<ConnectionType>('imap');

  // IMAP config state
  const [imapConfig, setImapConfig] = useState<ImapConfig>({
    host: '',
    port: 993,
    user: '',
    password: '',
    folder: 'INBOX',
    tls: true,
  });

  // SFTP config state
  const [sftpConfig, setSftpConfig] = useState<SftpConfig>({
    host: '',
    port: 22,
    user: '',
    password: '',
    remotePath: '/invoices',
    archivePath: '',
  });

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: () => {
      const config = connectionType === 'imap' ? imapConfig : sftpConfig;
      return dataSourcesApi.testConnection({ type: connectionType, config });
    },
    onSuccess: (result) => {
      if (result.success) {
        toast.success(result.message);
        if (result.folderInfo) {
          toast.info(`Found ${result.folderInfo.unseenMessages} unseen emails in ${result.folderInfo.name}`);
        }
        if (result.directoryInfo) {
          toast.info(`Found ${result.directoryInfo.invoiceFileCount} invoice files in ${result.directoryInfo.path}`);
        }
      } else {
        toast.error(result.message);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Connection test failed');
    },
  });

  // Fetch now mutation
  const fetchNowMutation = useMutation({
    mutationFn: () => {
      const config = connectionType === 'imap' ? imapConfig : sftpConfig;
      return dataSourcesApi.fetchNow(dataSourceId, { type: connectionType, config });
    },
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Processed ${result.processed} invoices, skipped ${result.skipped}, failed ${result.failed}`);
        if (result.extractionIds.length > 0) {
          onFetchComplete?.(result.extractionIds);
        }
      } else {
        toast.error('Fetch failed');
        if (result.errors.length > 0) {
          result.errors.forEach((err) => toast.error(err));
        }
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Fetch failed');
    },
  });

  const isLoading = testConnectionMutation.isPending || fetchNowMutation.isPending;

  // Check if config is valid for testing
  const isImapConfigValid = imapConfig.host && imapConfig.user && imapConfig.password;
  const isSftpConfigValid = sftpConfig.host && sftpConfig.user && sftpConfig.password && sftpConfig.remotePath;
  const isConfigValid = connectionType === 'imap' ? isImapConfigValid : isSftpConfigValid;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          Connection Configuration
        </CardTitle>
        <CardDescription>
          Configure IMAP or SFTP connection to automatically fetch invoices for &quot;{dataSourceName}&quot;
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={connectionType} onValueChange={(v) => setConnectionType(v as ConnectionType)}>
          <TabsList className="mb-4">
            <TabsTrigger value="imap" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email (IMAP)
            </TabsTrigger>
            <TabsTrigger value="sftp" className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              SFTP
            </TabsTrigger>
          </TabsList>

          {/* IMAP Configuration */}
          <TabsContent value="imap" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="imap-host">IMAP Host</Label>
                <Input
                  id="imap-host"
                  placeholder="imap.example.com"
                  value={imapConfig.host}
                  onChange={(e) => setImapConfig({ ...imapConfig, host: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="imap-port">Port</Label>
                <Input
                  id="imap-port"
                  type="number"
                  placeholder="993"
                  value={imapConfig.port}
                  onChange={(e) => setImapConfig({ ...imapConfig, port: parseInt(e.target.value) || 993 })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="imap-user">Username</Label>
                <Input
                  id="imap-user"
                  placeholder="user@example.com"
                  value={imapConfig.user}
                  onChange={(e) => setImapConfig({ ...imapConfig, user: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="imap-password">Password</Label>
                <Input
                  id="imap-password"
                  type="password"
                  placeholder="Password"
                  value={imapConfig.password}
                  onChange={(e) => setImapConfig({ ...imapConfig, password: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="imap-folder">Folder</Label>
                <Input
                  id="imap-folder"
                  placeholder="INBOX"
                  value={imapConfig.folder}
                  onChange={(e) => setImapConfig({ ...imapConfig, folder: e.target.value })}
                />
              </div>
              <div className="flex items-center space-x-2 pt-6">
                <Checkbox
                  id="imap-tls"
                  checked={imapConfig.tls}
                  onCheckedChange={(checked) => setImapConfig({ ...imapConfig, tls: !!checked })}
                />
                <Label htmlFor="imap-tls" className="flex items-center gap-1 cursor-pointer">
                  <Lock className="h-3 w-3" />
                  Use TLS/SSL
                </Label>
              </div>
            </div>
          </TabsContent>

          {/* SFTP Configuration */}
          <TabsContent value="sftp" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sftp-host">SFTP Host</Label>
                <Input
                  id="sftp-host"
                  placeholder="sftp.example.com"
                  value={sftpConfig.host}
                  onChange={(e) => setSftpConfig({ ...sftpConfig, host: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sftp-port">Port</Label>
                <Input
                  id="sftp-port"
                  type="number"
                  placeholder="22"
                  value={sftpConfig.port}
                  onChange={(e) => setSftpConfig({ ...sftpConfig, port: parseInt(e.target.value) || 22 })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sftp-user">Username</Label>
                <Input
                  id="sftp-user"
                  placeholder="username"
                  value={sftpConfig.user}
                  onChange={(e) => setSftpConfig({ ...sftpConfig, user: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sftp-password">Password</Label>
                <Input
                  id="sftp-password"
                  type="password"
                  placeholder="Password"
                  value={sftpConfig.password}
                  onChange={(e) => setSftpConfig({ ...sftpConfig, password: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sftp-path">Remote Path</Label>
                <Input
                  id="sftp-path"
                  placeholder="/invoices"
                  value={sftpConfig.remotePath}
                  onChange={(e) => setSftpConfig({ ...sftpConfig, remotePath: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sftp-archive">Archive Path (optional)</Label>
                <Input
                  id="sftp-archive"
                  placeholder="/invoices/processed"
                  value={sftpConfig.archivePath}
                  onChange={(e) => setSftpConfig({ ...sftpConfig, archivePath: e.target.value })}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Test Result */}
        {testConnectionMutation.data && (
          <div className={`mt-4 p-3 rounded-lg flex items-center gap-2 ${
            testConnectionMutation.data.success
              ? 'bg-green-50 text-green-800'
              : 'bg-red-50 text-red-800'
          }`}>
            {testConnectionMutation.data.success ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <XCircle className="h-5 w-5" />
            )}
            <span>{testConnectionMutation.data.message}</span>
            {testConnectionMutation.data.folderInfo && (
              <Badge variant="outline" className="ml-auto">
                {testConnectionMutation.data.folderInfo.unseenMessages} unseen
              </Badge>
            )}
            {testConnectionMutation.data.directoryInfo && (
              <Badge variant="outline" className="ml-auto">
                {testConnectionMutation.data.directoryInfo.invoiceFileCount} files
              </Badge>
            )}
          </div>
        )}

        {/* Fetch Result */}
        {fetchNowMutation.data && (
          <div className={`mt-4 p-3 rounded-lg ${
            fetchNowMutation.data.success
              ? 'bg-blue-50 text-blue-800'
              : 'bg-red-50 text-red-800'
          }`}>
            <div className="flex items-center gap-4">
              <span className="font-medium">Fetch Results:</span>
              <Badge variant="outline" className="bg-green-100">
                {fetchNowMutation.data.processed} processed
              </Badge>
              <Badge variant="outline" className="bg-yellow-100">
                {fetchNowMutation.data.skipped} skipped
              </Badge>
              {fetchNowMutation.data.failed > 0 && (
                <Badge variant="outline" className="bg-red-100">
                  {fetchNowMutation.data.failed} failed
                </Badge>
              )}
            </div>
            {fetchNowMutation.data.errors.length > 0 && (
              <div className="mt-2 text-sm text-red-600">
                {fetchNowMutation.data.errors.map((err, i) => (
                  <div key={i}>{err}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <Button
            variant="outline"
            onClick={() => testConnectionMutation.mutate()}
            disabled={isLoading || !isConfigValid}
          >
            {testConnectionMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Test Connection
          </Button>
          <Button
            onClick={() => fetchNowMutation.mutate()}
            disabled={isLoading || !isConfigValid}
          >
            {fetchNowMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Fetch Now
          </Button>
        </div>

        {!isConfigValid && (
          <p className="text-sm text-amber-600 mt-3">
            Please fill in all required connection fields to test or fetch.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * SFTP Fetcher Service
 *
 * SFTP file polling service for fetching invoice files from remote servers.
 * Uses ssh2-sftp-client for SFTP operations.
 */

import SftpClient from 'ssh2-sftp-client';
import path from 'path';
import { logger } from '../utils/logger';

export interface SftpConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  privateKey?: string | Buffer;
  passphrase?: string;
  remotePath: string;
  archivePath?: string;
}

export interface SftpFileInfo {
  name: string;
  path: string;
  size: number;
  modifyTime: Date;
  accessTime: Date;
  type: string;
}

export interface FetchedFile {
  filename: string;
  remotePath: string;
  content: Buffer;
  size: number;
  modifyTime: Date;
}

// Allowed file extensions for invoices
const ALLOWED_EXTENSIONS = ['.pdf', '.csv', '.xls', '.xlsx', '.png', '.jpg', '.jpeg'];

/**
 * Test SFTP connection with provided credentials
 */
export async function testSftpConnection(config: SftpConfig): Promise<{
  success: boolean;
  message: string;
  directoryInfo?: {
    path: string;
    fileCount: number;
    invoiceFileCount: number;
  };
}> {
  const sftp = new SftpClient();

  try {
    logger.info(
      { host: config.host, port: config.port, user: config.user },
      'Testing SFTP connection'
    );

    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.user,
      password: config.password,
      privateKey: config.privateKey,
      passphrase: config.passphrase,
      readyTimeout: 30000,
      retries: 1,
    });

    // List files in the remote path
    const files = await sftp.list(config.remotePath);

    // Count invoice files
    const invoiceFiles = files.filter(
      file => file.type === '-' && isInvoiceFile(file.name)
    );

    logger.info(
      { path: config.remotePath, totalFiles: files.length, invoiceFiles: invoiceFiles.length },
      'SFTP connection successful'
    );

    return {
      success: true,
      message: `Connected successfully to ${config.host}`,
      directoryInfo: {
        path: config.remotePath,
        fileCount: files.length,
        invoiceFileCount: invoiceFiles.length,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, host: config.host }, 'SFTP connection test failed');

    return {
      success: false,
      message: `Connection failed: ${errorMessage}`,
    };
  } finally {
    try {
      await sftp.end();
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Check if a filename is an allowed invoice file type
 */
function isInvoiceFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

/**
 * List invoice files in the remote directory
 */
export async function listInvoiceFiles(
  config: SftpConfig,
  options: {
    sinceDate?: Date;
    limit?: number;
  } = {}
): Promise<{
  success: boolean;
  files: SftpFileInfo[];
  error?: string;
}> {
  const sftp = new SftpClient();

  try {
    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.user,
      password: config.password,
      privateKey: config.privateKey,
      passphrase: config.passphrase,
      readyTimeout: 30000,
      retries: 1,
    });

    logger.info({ path: config.remotePath }, 'Listing SFTP directory');

    const allFiles = await sftp.list(config.remotePath);

    // Filter to invoice files only (regular files with allowed extensions)
    let invoiceFiles = allFiles
      .filter(file => file.type === '-' && isInvoiceFile(file.name))
      .map(file => ({
        name: file.name,
        path: path.join(config.remotePath, file.name),
        size: file.size,
        modifyTime: new Date(file.modifyTime),
        accessTime: new Date(file.accessTime),
        type: path.extname(file.name).toLowerCase(),
      }));

    // Filter by date if specified
    if (options.sinceDate) {
      invoiceFiles = invoiceFiles.filter(
        file => file.modifyTime >= options.sinceDate!
      );
    }

    // Sort by modify time (newest first)
    invoiceFiles.sort((a, b) => b.modifyTime.getTime() - a.modifyTime.getTime());

    // Limit if specified
    if (options.limit) {
      invoiceFiles = invoiceFiles.slice(0, options.limit);
    }

    logger.info(
      { totalFiles: allFiles.length, invoiceFiles: invoiceFiles.length },
      'Listed SFTP directory'
    );

    return {
      success: true,
      files: invoiceFiles,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, path: config.remotePath }, 'Failed to list SFTP directory');

    return {
      success: false,
      files: [],
      error: errorMessage,
    };
  } finally {
    try {
      await sftp.end();
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Download a file from SFTP server
 */
export async function downloadFile(
  config: SftpConfig,
  remotePath: string
): Promise<{
  success: boolean;
  file?: FetchedFile;
  error?: string;
}> {
  const sftp = new SftpClient();

  try {
    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.user,
      password: config.password,
      privateKey: config.privateKey,
      passphrase: config.passphrase,
      readyTimeout: 30000,
      retries: 1,
    });

    logger.info({ remotePath }, 'Downloading file from SFTP');

    // Get file info
    const stat = await sftp.stat(remotePath);

    // Download file content as buffer
    const content = await sftp.get(remotePath) as Buffer;

    const filename = path.basename(remotePath);

    logger.info({ remotePath, size: content.length }, 'Downloaded file from SFTP');

    return {
      success: true,
      file: {
        filename,
        remotePath,
        content,
        size: content.length,
        modifyTime: new Date(stat.modifyTime),
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, remotePath }, 'Failed to download SFTP file');

    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    try {
      await sftp.end();
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Fetch multiple files from SFTP server
 */
export async function fetchNewFiles(
  config: SftpConfig,
  options: {
    sinceDate?: Date;
    limit?: number;
    excludePaths?: string[];
  } = {}
): Promise<{
  success: boolean;
  files: FetchedFile[];
  error?: string;
}> {
  const sftp = new SftpClient();
  const files: FetchedFile[] = [];

  try {
    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.user,
      password: config.password,
      privateKey: config.privateKey,
      passphrase: config.passphrase,
      readyTimeout: 30000,
      retries: 1,
    });

    logger.info({ path: config.remotePath }, 'Fetching new files from SFTP');

    const allFiles = await sftp.list(config.remotePath);

    // Filter to invoice files
    let invoiceFiles = allFiles
      .filter(file => file.type === '-' && isInvoiceFile(file.name))
      .map(file => ({
        name: file.name,
        path: path.join(config.remotePath, file.name),
        modifyTime: new Date(file.modifyTime),
        size: file.size,
      }));

    // Filter by date
    if (options.sinceDate) {
      invoiceFiles = invoiceFiles.filter(f => f.modifyTime >= options.sinceDate!);
    }

    // Exclude already processed paths
    if (options.excludePaths && options.excludePaths.length > 0) {
      const excludeSet = new Set(options.excludePaths);
      invoiceFiles = invoiceFiles.filter(f => !excludeSet.has(f.path));
    }

    // Sort by modify time and limit
    invoiceFiles.sort((a, b) => a.modifyTime.getTime() - b.modifyTime.getTime());
    if (options.limit) {
      invoiceFiles = invoiceFiles.slice(0, options.limit);
    }

    // Download each file
    for (const fileInfo of invoiceFiles) {
      try {
        const content = await sftp.get(fileInfo.path) as Buffer;

        files.push({
          filename: fileInfo.name,
          remotePath: fileInfo.path,
          content,
          size: content.length,
          modifyTime: fileInfo.modifyTime,
        });
      } catch (error) {
        logger.error(
          { error: (error as Error).message, path: fileInfo.path },
          'Failed to download individual file'
        );
        // Continue with other files
      }
    }

    logger.info(
      { totalFound: invoiceFiles.length, downloaded: files.length },
      'SFTP fetch completed'
    );

    return {
      success: true,
      files,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, path: config.remotePath }, 'Failed to fetch SFTP files');

    return {
      success: false,
      files: [],
      error: errorMessage,
    };
  } finally {
    try {
      await sftp.end();
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Move a file to archive folder on SFTP server
 */
export async function moveToArchive(
  config: SftpConfig,
  remotePath: string
): Promise<{ success: boolean; error?: string; newPath?: string }> {
  if (!config.archivePath) {
    return { success: true }; // No archive configured, skip
  }

  const sftp = new SftpClient();

  try {
    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.user,
      password: config.password,
      privateKey: config.privateKey,
      passphrase: config.passphrase,
      readyTimeout: 30000,
      retries: 1,
    });

    // Ensure archive directory exists
    try {
      await sftp.mkdir(config.archivePath, true);
    } catch {
      // Directory might already exist
    }

    const filename = path.basename(remotePath);
    const archiveDest = path.join(config.archivePath, filename);

    // Rename (move) file to archive
    await sftp.rename(remotePath, archiveDest);

    logger.info({ from: remotePath, to: archiveDest }, 'Moved file to archive');

    return { success: true, newPath: archiveDest };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, remotePath }, 'Failed to move file to archive');

    return { success: false, error: errorMessage };
  } finally {
    try {
      await sftp.end();
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Delete a file from SFTP server (use with caution)
 */
export async function deleteFile(
  config: SftpConfig,
  remotePath: string
): Promise<{ success: boolean; error?: string }> {
  const sftp = new SftpClient();

  try {
    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.user,
      password: config.password,
      privateKey: config.privateKey,
      passphrase: config.passphrase,
      readyTimeout: 30000,
      retries: 1,
    });

    await sftp.delete(remotePath);

    logger.info({ remotePath }, 'Deleted file from SFTP');

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage, remotePath }, 'Failed to delete SFTP file');

    return { success: false, error: errorMessage };
  } finally {
    try {
      await sftp.end();
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Get SFTP config from environment variables
 */
export function getSftpConfigFromEnv(): SftpConfig | null {
  const host = process.env.INVOICE_SFTP_HOST;
  const user = process.env.INVOICE_SFTP_USER;
  const password = process.env.INVOICE_SFTP_PASSWORD;
  const remotePath = process.env.INVOICE_SFTP_PATH;

  if (!host || !user || !remotePath) {
    return null;
  }

  return {
    host,
    port: parseInt(process.env.INVOICE_SFTP_PORT || '22', 10),
    user,
    password,
    remotePath,
    archivePath: process.env.INVOICE_SFTP_ARCHIVE_PATH,
  };
}

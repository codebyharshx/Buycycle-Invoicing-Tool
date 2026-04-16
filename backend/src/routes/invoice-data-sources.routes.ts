/**
 * Invoice Data Sources Routes
 * CRUD operations for email-based invoice ingestion sources
 * Uses PostgreSQL (Neon) - same database as threads
 */

import express, { Request, Response } from 'express';
import {
  CreateInvoiceDataSourceRequest,
  UpdateInvoiceDataSourceRequest,
  InvoiceDataSourceStatus,
  INVOICE_DATA_SOURCE_STATUSES,
} from '@shared/types';
import {
  listDataSources,
  getDataSourceById,
  createDataSource,
  updateDataSource,
  archiveDataSource,
  getDataSourceLogs,
} from '../services/invoice-data-sources.service';
import { testImapConnection, ImapConfig } from '../services/email-fetcher.service';
import { testSftpConnection, SftpConfig } from '../services/sftp-fetcher.service';
import { triggerDataSourceFetch } from '../services/auto-ingest.service';
import { getSchedulerStatus, triggerJob } from '../services/scheduler.service';

const router = express.Router();

/**
 * GET /api/invoice-data-sources
 * List all data sources with optional search and pagination
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string) || undefined;
    const status = req.query.status as InvoiceDataSourceStatus | undefined;
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    // Validate status if provided
    if (status && !INVOICE_DATA_SOURCE_STATUSES.includes(status)) {
      res.status(400).json({
        error: `Invalid status. Must be one of: ${INVOICE_DATA_SOURCE_STATUSES.join(', ')}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ search, status, limit, offset }, 'Listing invoice data sources');

    const result = await listDataSources({ search, status, limit, offset });

    res.json(result);
  } catch (error) {
    req.log.error({ error }, 'Error listing invoice data sources');
    res.status(500).json({
      error: 'Failed to list invoice data sources',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/invoice-data-sources/:id
 * Get a single data source by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({
        error: 'Invalid data source ID',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ dataSourceId: id }, 'Fetching invoice data source');

    const dataSource = await getDataSourceById(id);

    if (!dataSource) {
      res.status(404).json({
        error: 'Data source not found',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.json(dataSource);
  } catch (error) {
    req.log.error({ error }, 'Error fetching invoice data source');
    res.status(500).json({
      error: 'Failed to fetch invoice data source',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/invoice-data-sources
 * Create a new data source
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateInvoiceDataSourceRequest;

    // Validation
    if (!body.name || body.name.trim() === '') {
      res.status(400).json({
        error: 'Missing required field: name',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!body.email_address || body.email_address.trim() === '') {
      res.status(400).json({
        error: 'Missing required field: email_address',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email_address)) {
      res.status(400).json({
        error: 'Invalid email address format',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ name: body.name, email: body.email_address }, 'Creating invoice data source');

    const dataSource = await createDataSource(body);

    req.log.info({ dataSourceId: dataSource.id, name: dataSource.name }, 'Invoice data source created');

    res.status(201).json(dataSource);
  } catch (error) {
    req.log.error({ error }, 'Error creating invoice data source');

    // Check for duplicate email error
    if (error instanceof Error && error.message.includes('already exists')) {
      res.status(409).json({
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(500).json({
      error: 'Failed to create invoice data source',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * PATCH /api/invoice-data-sources/:id
 * Update a data source
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({
        error: 'Invalid data source ID',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const body = req.body as UpdateInvoiceDataSourceRequest;

    // Validate name if provided
    if (body.name !== undefined && body.name.trim() === '') {
      res.status(400).json({
        error: 'Name cannot be empty',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Validate status if provided
    if (body.status && !INVOICE_DATA_SOURCE_STATUSES.includes(body.status)) {
      res.status(400).json({
        error: `Invalid status. Must be one of: ${INVOICE_DATA_SOURCE_STATUSES.join(', ')}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ dataSourceId: id, updates: Object.keys(body) }, 'Updating invoice data source');

    const dataSource = await updateDataSource(id, body);

    req.log.info({ dataSourceId: dataSource.id, name: dataSource.name }, 'Invoice data source updated');

    res.json(dataSource);
  } catch (error) {
    req.log.error({ error }, 'Error updating invoice data source');

    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({
        error: 'Data source not found',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(500).json({
      error: 'Failed to update invoice data source',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * DELETE /api/invoice-data-sources/:id
 * Archive a data source (soft delete)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({
        error: 'Invalid data source ID',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ dataSourceId: id }, 'Archiving invoice data source');

    await archiveDataSource(id);

    req.log.info({ dataSourceId: id }, 'Invoice data source archived');

    res.json({
      message: 'Data source archived successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ error }, 'Error archiving invoice data source');

    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({
        error: 'Data source not found or already archived',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(500).json({
      error: 'Failed to archive invoice data source',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/invoice-data-sources/:id/logs
 * Get activity logs for a data source
 */
router.get('/:id/logs', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({
        error: 'Invalid data source ID',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    req.log.info({ dataSourceId: id, limit, offset }, 'Fetching invoice data source logs');

    // Verify data source exists
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      res.status(404).json({
        error: 'Data source not found',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const result = await getDataSourceLogs(id, { limit, offset });

    res.json(result);
  } catch (error) {
    req.log.error({ error }, 'Error fetching invoice data source logs');
    res.status(500).json({
      error: 'Failed to fetch invoice data source logs',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================================================
// Connection Test and Manual Fetch Endpoints
// ============================================================================

/**
 * POST /api/invoice-data-sources/test-connection
 * Test IMAP or SFTP connection with provided credentials
 */
router.post('/test-connection', async (req: Request, res: Response) => {
  try {
    const { type, config } = req.body as {
      type: 'imap' | 'sftp';
      config: ImapConfig | SftpConfig;
    };

    if (!type || !config) {
      res.status(400).json({
        error: 'Missing required fields: type and config',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ type }, 'Testing connection');

    let result;
    if (type === 'imap') {
      result = await testImapConnection(config as ImapConfig);
    } else if (type === 'sftp') {
      result = await testSftpConnection(config as SftpConfig);
    } else {
      res.status(400).json({
        error: 'Invalid connection type. Must be "imap" or "sftp"',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ type, success: result.success }, 'Connection test completed');

    res.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ error }, 'Error testing connection');
    res.status(500).json({
      success: false,
      error: 'Failed to test connection',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/invoice-data-sources/:id/fetch-now
 * Manually trigger an immediate fetch for a data source
 */
router.post('/:id/fetch-now', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({
        error: 'Invalid data source ID',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { type, config } = req.body as {
      type: 'imap' | 'sftp';
      config: ImapConfig | SftpConfig;
    };

    if (!type || !config) {
      res.status(400).json({
        error: 'Missing required fields: type and config',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Verify data source exists
    const dataSource = await getDataSourceById(id);
    if (!dataSource) {
      res.status(404).json({
        error: 'Data source not found',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (dataSource.status !== 'active') {
      res.status(400).json({
        error: 'Data source is not active',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ dataSourceId: id, type }, 'Triggering manual fetch');

    const result = await triggerDataSourceFetch(id, type, config);

    req.log.info(
      {
        dataSourceId: id,
        processed: result.processedCount,
        skipped: result.skippedCount,
        failed: result.failedCount,
      },
      'Manual fetch completed'
    );

    res.json({
      success: result.success,
      processed: result.processedCount,
      skipped: result.skippedCount,
      failed: result.failedCount,
      errors: result.errors,
      extractionIds: result.extractionIds,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ error }, 'Error triggering manual fetch');
    res.status(500).json({
      success: false,
      error: 'Failed to trigger fetch',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/invoice-data-sources/scheduler/status
 * Get the status of all scheduled fetch jobs
 */
router.get('/scheduler/status', async (req: Request, res: Response) => {
  try {
    const status = getSchedulerStatus();

    res.json({
      ...status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ error }, 'Error getting scheduler status');
    res.status(500).json({
      error: 'Failed to get scheduler status',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/invoice-data-sources/scheduler/trigger/:jobId
 * Manually trigger a specific scheduled job
 */
router.post('/scheduler/trigger/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    req.log.info({ jobId }, 'Triggering scheduled job');

    const result = await triggerJob(jobId);

    res.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ error }, 'Error triggering scheduled job');
    res.status(500).json({
      success: false,
      error: 'Failed to trigger job',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

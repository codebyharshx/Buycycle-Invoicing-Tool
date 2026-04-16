/**
 * Scheduler Service
 *
 * Manages scheduled jobs for automated invoice fetching.
 * Uses node-cron for scheduling with configurable intervals.
 */

import cron from 'node-cron';
import { logger } from '../utils/logger';
import { getPgPool } from '../utils/db';
import {
  processImapDataSource,
  processSftpDataSource,
  processDefaultImapSource,
  processDefaultSftpSource,
} from './auto-ingest.service';
import { getImapConfigFromEnv } from './email-fetcher.service';
import { getSftpConfigFromEnv } from './sftp-fetcher.service';
import { initDuplicateDetection } from './duplicate-detector.service';

interface ScheduledJob {
  id: string;
  name: string;
  task: ReturnType<typeof cron.schedule>;
  fetchFn: () => Promise<void>;
  interval: number; // in minutes
  lastRun?: Date;
  nextRun?: Date;
  isRunning: boolean;
}

// Active scheduled jobs
const scheduledJobs: Map<string, ScheduledJob> = new Map();

// Flag to track if scheduler is initialized
let schedulerInitialized = false;

/**
 * Convert minutes to cron expression
 */
function minutesToCron(minutes: number): string {
  if (minutes < 1) minutes = 1;
  if (minutes >= 60) {
    // Run every N hours
    const hours = Math.floor(minutes / 60);
    return `0 */${hours} * * *`;
  }
  // Run every N minutes
  return `*/${minutes} * * * *`;
}

/**
 * Create a scheduled job for IMAP polling
 */
function scheduleImapJob(
  jobId: string,
  name: string,
  intervalMinutes: number,
  fetchFn: () => Promise<void>
): ScheduledJob | null {
  const cronExpression = minutesToCron(intervalMinutes);

  logger.info(
    { jobId, name, intervalMinutes, cronExpression },
    'Scheduling IMAP job'
  );

  const task = cron.schedule(cronExpression, async () => {
    const job = scheduledJobs.get(jobId);
    if (job && job.isRunning) {
      logger.warn({ jobId }, 'Skipping job - previous run still in progress');
      return;
    }

    if (job) {
      job.isRunning = true;
      job.lastRun = new Date();
    }

    try {
      await fetchFn();
    } catch (error) {
      logger.error(
        { error: (error as Error).message, jobId },
        'Scheduled job failed'
      );
    } finally {
      if (job) {
        job.isRunning = false;
        job.nextRun = getNextRunTime(cronExpression);
      }
    }
  });

  const job: ScheduledJob = {
    id: jobId,
    name,
    task,
    fetchFn,
    interval: intervalMinutes,
    nextRun: getNextRunTime(cronExpression),
    isRunning: false,
  };

  scheduledJobs.set(jobId, job);
  return job;
}

/**
 * Calculate next run time from cron expression
 */
function getNextRunTime(cronExpression: string): Date {
  // Simple approximation - actual cron-parser would be more accurate
  const now = new Date();
  const parts = cronExpression.split(' ');

  // Extract interval from cron expression like */15 or */1
  const minutePart = parts[0];
  if (minutePart.startsWith('*/')) {
    const interval = parseInt(minutePart.slice(2), 10);
    const currentMinute = now.getMinutes();
    const nextMinute = Math.ceil((currentMinute + 1) / interval) * interval;
    const result = new Date(now);
    result.setMinutes(nextMinute, 0, 0);
    if (result <= now) {
      result.setMinutes(result.getMinutes() + interval);
    }
    return result;
  }

  // For hourly schedules
  const hourPart = parts[1];
  if (hourPart.startsWith('*/')) {
    const interval = parseInt(hourPart.slice(2), 10);
    const result = new Date(now);
    result.setMinutes(0, 0, 0);
    result.setHours(Math.ceil((now.getHours() + 1) / interval) * interval);
    return result;
  }

  // Fallback: next hour
  const result = new Date(now);
  result.setHours(result.getHours() + 1, 0, 0, 0);
  return result;
}

/**
 * Initialize and start the default IMAP scheduler from environment
 */
async function initDefaultImapScheduler(): Promise<void> {
  const config = getImapConfigFromEnv();
  if (!config) {
    logger.info('No IMAP configuration in environment - skipping IMAP scheduler');
    return;
  }

  const intervalMinutes = parseInt(
    process.env.INVOICE_IMAP_POLL_INTERVAL || '15',
    10
  );

  scheduleImapJob('default-imap', 'Default IMAP Source', intervalMinutes, async () => {
    logger.info('Running default IMAP fetch');
    const result = await processDefaultImapSource();
    if (result) {
      logger.info(
        {
          processed: result.processedCount,
          skipped: result.skippedCount,
          failed: result.failedCount,
        },
        'Default IMAP fetch completed'
      );
    }
  });

  logger.info(
    { host: config.host, intervalMinutes },
    'Default IMAP scheduler initialized'
  );
}

/**
 * Initialize and start the default SFTP scheduler from environment
 */
async function initDefaultSftpScheduler(): Promise<void> {
  const config = getSftpConfigFromEnv();
  if (!config) {
    logger.info('No SFTP configuration in environment - skipping SFTP scheduler');
    return;
  }

  const intervalMinutes = parseInt(
    process.env.INVOICE_SFTP_POLL_INTERVAL || '60',
    10
  );

  scheduleImapJob('default-sftp', 'Default SFTP Source', intervalMinutes, async () => {
    logger.info('Running default SFTP fetch');
    const result = await processDefaultSftpSource();
    if (result) {
      logger.info(
        {
          processed: result.processedCount,
          skipped: result.skippedCount,
          failed: result.failedCount,
        },
        'Default SFTP fetch completed'
      );
    }
  });

  logger.info(
    { host: config.host, path: config.remotePath, intervalMinutes },
    'Default SFTP scheduler initialized'
  );
}

/**
 * Load and schedule jobs from database data sources
 */
async function loadDataSourceSchedulers(): Promise<void> {
  const pool = getPgPool();
  if (!pool) {
    logger.warn('PostgreSQL not available - skipping database data source schedulers');
    return;
  }

  try {
    // Query active data sources with connection config
    const result = await pool.query(`
      SELECT id, name, email_address, vendor_hint, status
      FROM invoice_data_sources
      WHERE status = 'active'
    `);

    logger.info(
      { count: result.rows.length },
      'Found active data sources in database'
    );

    // Note: Currently data sources don't store IMAP/SFTP config in DB
    // They're configured via environment. This is a placeholder for future
    // when we add connection config to the database schema.

    // For now, we only support env-based schedulers
  } catch (error) {
    logger.error({ error }, 'Failed to load data source schedulers');
  }
}

/**
 * Start all schedulers
 */
export async function startScheduler(): Promise<void> {
  if (schedulerInitialized) {
    logger.warn('Scheduler already initialized');
    return;
  }

  logger.info('Starting invoice auto-fetch scheduler');

  // Initialize duplicate detection tables
  await initDuplicateDetection();

  // Start default schedulers from environment
  await initDefaultImapScheduler();
  await initDefaultSftpScheduler();

  // Load schedulers from database
  await loadDataSourceSchedulers();

  schedulerInitialized = true;

  logger.info(
    { activeJobs: scheduledJobs.size },
    'Invoice auto-fetch scheduler started'
  );
}

/**
 * Stop all schedulers
 */
export function stopScheduler(): void {
  logger.info('Stopping invoice auto-fetch scheduler');

  for (const [jobId, job] of scheduledJobs) {
    job.task.stop();
    logger.info({ jobId, name: job.name }, 'Stopped scheduled job');
  }

  scheduledJobs.clear();
  schedulerInitialized = false;

  logger.info('Invoice auto-fetch scheduler stopped');
}

/**
 * Get status of all scheduled jobs
 */
export function getSchedulerStatus(): {
  initialized: boolean;
  jobs: Array<{
    id: string;
    name: string;
    interval: number;
    lastRun?: Date;
    nextRun?: Date;
    isRunning: boolean;
  }>;
} {
  return {
    initialized: schedulerInitialized,
    jobs: Array.from(scheduledJobs.values()).map(job => ({
      id: job.id,
      name: job.name,
      interval: job.interval,
      lastRun: job.lastRun,
      nextRun: job.nextRun,
      isRunning: job.isRunning,
    })),
  };
}

/**
 * Manually trigger a specific scheduled job
 */
export async function triggerJob(jobId: string): Promise<{
  success: boolean;
  message: string;
}> {
  const job = scheduledJobs.get(jobId);

  if (!job) {
    return {
      success: false,
      message: `Job ${jobId} not found`,
    };
  }

  if (job.isRunning) {
    return {
      success: false,
      message: `Job ${jobId} is already running`,
    };
  }

  // Trigger the job manually by calling the stored fetch function
  // Run in background to not block the response
  (async () => {
    job.isRunning = true;
    job.lastRun = new Date();
    try {
      await job.fetchFn();
    } catch (error) {
      logger.error({ error: (error as Error).message, jobId }, 'Manual job trigger failed');
    } finally {
      job.isRunning = false;
    }
  })();

  return {
    success: true,
    message: `Job ${jobId} triggered successfully`,
  };
}

/**
 * Add a new scheduled job dynamically
 */
export function addScheduledJob(
  jobId: string,
  name: string,
  intervalMinutes: number,
  fetchFn: () => Promise<void>
): boolean {
  if (scheduledJobs.has(jobId)) {
    logger.warn({ jobId }, 'Job with this ID already exists');
    return false;
  }

  const job = scheduleImapJob(jobId, name, intervalMinutes, fetchFn);
  return job !== null;
}

/**
 * Remove a scheduled job
 */
export function removeScheduledJob(jobId: string): boolean {
  const job = scheduledJobs.get(jobId);
  if (!job) {
    return false;
  }

  job.task.stop();
  scheduledJobs.delete(jobId);

  logger.info({ jobId, name: job.name }, 'Removed scheduled job');
  return true;
}

/**
 * Update a job's schedule interval
 */
export function updateJobInterval(jobId: string, newIntervalMinutes: number): boolean {
  const job = scheduledJobs.get(jobId);
  if (!job) {
    return false;
  }

  // Stop old task
  job.task.stop();

  // Create new task with new interval
  const cronExpression = minutesToCron(newIntervalMinutes);

  // We need to recreate the task - get the original fetch function
  // This is a limitation - we'd need to store the fetch function reference
  logger.warn(
    { jobId, newIntervalMinutes },
    'Job interval update requires restarting scheduler'
  );

  return false; // Not fully implemented - would need to store fetch function
}

import mysql from 'mysql2/promise';
import { Pool as PgPool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';

// Try multiple possible locations for .env file (handles different build configurations)
const possibleEnvPaths = [
  path.join(process.cwd(), 'backend', '.env'),      // From project root
  path.join(__dirname, '../../.env'),                // From compiled dist/utils
  path.join(__dirname, '../../../backend', '.env'),  // From compiled root
  path.join(process.cwd(), '.env'),                  // Fallback: project root
];

let envLoaded = false;

for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    const result = dotenv.config({ path: envPath });
    if (!result.error) {
      envLoaded = true;
      logger.info({ path: envPath }, '✅ Loaded .env file successfully');
      break;
    }
  }
}

if (!envLoaded) {
  logger.warn(
    { attemptedPaths: possibleEnvPaths },
    '⚠️ Could not load .env file from any expected location - using environment variables only'
  );
}

// Check if MySQL is configured
const MYSQL_ENABLED = !!(process.env.MYSQL_HOST && process.env.MYSQL_PASSWORD);

// Main database configuration (orders, users, products, bikes)
const MAIN_DB_HOST = process.env.MYSQL_HOST || '';
const MAIN_DB_USER = process.env.MYSQL_USER || 'admin';
const MAIN_DB_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MAIN_DB_NAME = 'buycycle';
const MAIN_DB_PORT = parseInt(process.env.MYSQL_PORT || '3306', 10);

// BLS Logistics database configuration (shipments only)
const BLS_DB_HOST = process.env.BLS_DB_HOST || process.env.MYSQL_HOST || '';
const BLS_DB_USER = process.env.BLS_DB_USER || process.env.MYSQL_USER || 'admin';
const BLS_DB_PASSWORD = process.env.BLS_DB_PASSWORD || process.env.MYSQL_PASSWORD || '';
const BLS_DB_NAME = 'buycycle';
const BLS_DB_PORT = parseInt(process.env.BLS_DB_PORT || '3306', 10);

// Logs database configuration (Adyen payment webhooks, logs)
const LOGS_DB_HOST = process.env.LOGS_DB_HOST || process.env.MYSQL_HOST || '';
const LOGS_DB_USER = process.env.LOGS_DB_USER || process.env.MYSQL_USER || 'admin';
const LOGS_DB_PASSWORD = process.env.LOGS_DB_PASSWORD || process.env.MYSQL_PASSWORD || '';
const LOGS_DB_NAME = 'buycycle_log';
const LOGS_DB_PORT = parseInt(process.env.LOGS_DB_PORT || '3306', 10);

/**
 * Shared pool options to prevent stale connections
 */
const sharedPoolOptions = {
  waitForConnections: true,
  connectionLimit: 50,
  queueLimit: 200,
  timezone: '+00:00',
  charset: 'utf8mb4',
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000,
  idleTimeout: 60000,
  maxIdle: 10,
};

// Only create MySQL pools if MySQL is configured
export const mainPool = MYSQL_ENABLED ? mysql.createPool({
  host: MAIN_DB_HOST,
  user: MAIN_DB_USER,
  password: MAIN_DB_PASSWORD,
  database: MAIN_DB_NAME,
  port: MAIN_DB_PORT,
  ...sharedPoolOptions,
}) : null;

export const blsPool = MYSQL_ENABLED ? mysql.createPool({
  host: BLS_DB_HOST,
  user: BLS_DB_USER,
  password: BLS_DB_PASSWORD,
  database: BLS_DB_NAME,
  port: BLS_DB_PORT,
  ...sharedPoolOptions,
}) : null;

export const logsPool = MYSQL_ENABLED ? mysql.createPool({
  host: LOGS_DB_HOST,
  user: LOGS_DB_USER,
  password: LOGS_DB_PASSWORD,
  database: LOGS_DB_NAME,
  port: LOGS_DB_PORT,
  ...sharedPoolOptions,
}) : null;

// Register error handlers on MySQL pools if they exist
if (MYSQL_ENABLED && mainPool && blsPool && logsPool) {
  const mysqlPools = [
    { pool: mainPool, name: 'mainPool' },
    { pool: blsPool, name: 'blsPool' },
    { pool: logsPool, name: 'logsPool' },
  ] as const;

  for (const { pool: p, name } of mysqlPools) {
    p.pool.on('error', (err) => {
      logger.warn({ err: err.message, pool: name }, 'MySQL pool error (non-fatal)');
    });
    logger.info({ pool: name }, 'MySQL pool error handler registered');
  }

  // Health-check watchdog for MySQL
  const MAX_CONSECUTIVE_FAILURES = 3;
  const HEALTH_CHECK_INTERVAL_MS = 60_000;

  const failureCounts: Record<string, number> = {};
  for (const { name } of mysqlPools) {
    failureCounts[name] = 0;
  }

  const healthCheckTimer = setInterval(async () => {
    for (const { pool: p, name } of mysqlPools) {
      try {
        await p.execute('SELECT 1');
        if (failureCounts[name] > 0) {
          logger.info({ pool: name, previousFailures: failureCounts[name] }, 'MySQL pool recovered');
        }
        failureCounts[name] = 0;
      } catch (err) {
        failureCounts[name]++;
        const errMsg = err instanceof Error ? err.message : String(err);

        if (failureCounts[name] >= MAX_CONSECUTIVE_FAILURES) {
          logger.fatal(
            { pool: name, consecutiveFailures: failureCounts[name], err: errMsg },
            'MySQL pool health check failed repeatedly — restarting process'
          );
          process.exit(1);
        } else {
          logger.warn(
            { pool: name, consecutiveFailures: failureCounts[name], err: errMsg },
            'MySQL pool health check failed (transient)'
          );
        }
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  healthCheckTimer.unref();
  logger.info({ intervalMs: HEALTH_CHECK_INTERVAL_MS }, 'MySQL health check watchdog started');
} else {
  logger.info('MySQL disabled - using PostgreSQL only');
}

/**
 * Legacy pool export for backward compatibility (points to main pool)
 * @deprecated Use mainPool instead
 */
export const pool = mainPool;

/**
 * PostgreSQL database pool - Primary database for this application
 */
let pgPoolInstance: PgPool | null = null;

function createPgPool(): PgPool | null {
  const databaseUrl = process.env.NEON_POSTGRES_URL || process.env.DATABASE_URL;

  if (!databaseUrl) {
    logger.warn('NEON_POSTGRES_URL/DATABASE_URL not set - PostgreSQL features disabled');
    return null;
  }

  try {
    const pool = new PgPool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      logger.warn({ err }, 'PostgreSQL pool error (non-fatal)');
    });

    logger.info('✅ PostgreSQL pool created');
    return pool;
  } catch (err) {
    logger.warn({ err }, 'Failed to create PostgreSQL pool');
    return null;
  }
}

export function getPgPool(): PgPool | null {
  if (!pgPoolInstance) {
    pgPoolInstance = createPgPool();
  }
  return pgPoolInstance;
}

/**
 * Check if MySQL is available
 */
export function isMySQLEnabled(): boolean {
  return MYSQL_ENABLED;
}

/**
 * Test database connections with detailed health info
 */
export async function testConnection(): Promise<boolean> {
  // Test PostgreSQL first (primary)
  const pgPool = getPgPool();
  if (pgPool) {
    try {
      await pgPool.query('SELECT 1');
      logger.info('✅ PostgreSQL connection successful');
    } catch (error) {
      logger.error({ err: error }, '❌ PostgreSQL connection failed');
      return false;
    }
  }

  // Test MySQL only if enabled
  if (MYSQL_ENABLED && mainPool && blsPool && logsPool) {
    try {
      await mainPool.execute('SELECT 1');
      logger.info('✅ Main MySQL database connection successful');
    } catch (error) {
      logger.error({ err: error, pool: 'mainPool' }, '❌ Main MySQL database connection failed');
      return false;
    }

    try {
      await blsPool.execute('SELECT 1');
      logger.info('✅ BLS MySQL database connection successful');
    } catch (error) {
      logger.error({ err: error, pool: 'blsPool' }, '❌ BLS MySQL database connection failed');
      return false;
    }

    try {
      await logsPool.execute('SELECT 1');
      logger.info('✅ Logs MySQL database connection successful');
    } catch (error) {
      logger.error({ err: error, pool: 'logsPool' }, '❌ Logs MySQL database connection failed');
      return false;
    }
  }

  return true;
}

/**
 * Close all database pools. Call during graceful shutdown.
 */
export async function closeAllPools() {
  // Close PostgreSQL
  if (pgPoolInstance) {
    try {
      await pgPoolInstance.end();
      logger.info('PostgreSQL pool closed');
    } catch (err) {
      logger.warn({ err }, 'Error closing PostgreSQL pool');
    }
  }

  // Close MySQL pools if enabled
  if (MYSQL_ENABLED && mainPool && blsPool && logsPool) {
    const mysqlPools = [
      { pool: mainPool, name: 'mainPool' },
      { pool: blsPool, name: 'blsPool' },
      { pool: logsPool, name: 'logsPool' },
    ];

    for (const { pool: p, name } of mysqlPools) {
      try {
        await p.end();
        logger.info({ pool: name }, 'MySQL pool closed');
      } catch (err) {
        logger.warn({ err, pool: name }, 'Error closing MySQL pool');
      }
    }
  }
}

export default mainPool;

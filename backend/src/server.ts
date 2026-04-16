import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger';
import { requireAuth } from './middleware/auth';
import invoiceOcrRoutes from './routes/invoice-ocr.routes';
import invoiceTagsRoutes from './routes/invoice-tags.routes';
import invoiceDataSourcesRoutes from './routes/invoice-data-sources.routes';
import invoiceAutoLineItemsRoutes from './routes/invoice-auto-line-items.routes';
import threadsRoutes from './routes/threads.routes';
import authRoutes from './routes/auth.routes';
import notificationRoutes from './routes/notification.routes';
import { startScheduler, stopScheduler } from './services/scheduler.service';

const app = express();
const PORT = process.env.PORT || 3001;

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/health',
  '/api/auth/login',
];

// Middleware
app.use(pinoHttp({ logger }));
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3007',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check (public)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes (login is public, others are protected within the route file)
app.use('/api/auth', authRoutes);

// Global auth middleware for all other API routes
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  // Skip if it's a public route
  const fullPath = req.baseUrl + req.path;
  if (PUBLIC_ROUTES.some(route => fullPath.startsWith(route))) {
    return next();
  }

  // Skip auth routes (they handle their own auth)
  if (fullPath.startsWith('/api/auth')) {
    return next();
  }

  // Apply auth middleware
  return requireAuth(req, res, next);
});

// Protected API Routes
app.use('/api/invoice-ocr', invoiceOcrRoutes);
app.use('/api/invoice-tags', invoiceTagsRoutes);
app.use('/api/invoice-data-sources', invoiceDataSourcesRoutes);
app.use('/api/invoice-auto-line-items', invoiceAutoLineItemsRoutes);
app.use('/api/threads', threadsRoutes);
app.use('/api/notifications', notificationRoutes);

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server
const server = app.listen(PORT, async () => {
  logger.info({ port: PORT }, `Server running on port ${PORT}`);

  // Start the invoice auto-fetch scheduler
  // Only start if AUTO_FETCH_ENABLED is not explicitly set to 'false'
  if (process.env.AUTO_FETCH_ENABLED !== 'false') {
    try {
      await startScheduler();
      logger.info('Invoice auto-fetch scheduler started');
    } catch (error) {
      logger.error({ error }, 'Failed to start invoice auto-fetch scheduler');
    }
  } else {
    logger.info('Invoice auto-fetch scheduler disabled via AUTO_FETCH_ENABLED=false');
  }
});

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  logger.info({ signal }, 'Received shutdown signal');

  // Stop the scheduler first
  stopScheduler();

  // Close the server
  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error during server shutdown');
      process.exit(1);
    }
    logger.info('Server shutdown complete');
    process.exit(0);
  });

  // Force exit after 30 seconds
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger';
import invoiceOcrRoutes from './routes/invoice-ocr.routes';
import invoiceTagsRoutes from './routes/invoice-tags.routes';
import invoiceDataSourcesRoutes from './routes/invoice-data-sources.routes';
import invoiceAutoLineItemsRoutes from './routes/invoice-auto-line-items.routes';
import vendorRoutes from './routes/vendor.routes';
import threadsRoutes from './routes/threads.routes';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(pinoHttp({ logger }));
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3007',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/invoice-ocr', invoiceOcrRoutes);
app.use('/api/invoice-tags', invoiceTagsRoutes);
app.use('/api/invoice-data-sources', invoiceDataSourcesRoutes);
app.use('/api/invoice-auto-line-items', invoiceAutoLineItemsRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/threads', threadsRoutes);

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  logger.info({ port: PORT }, `Server running on port ${PORT}`);
});

export default app;

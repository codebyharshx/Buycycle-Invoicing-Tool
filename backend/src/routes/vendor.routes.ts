/**
 * Vendor Routes
 * CRUD operations for logistics invoice vendors
 * Uses PostgreSQL (Neon) - same database as threads
 */

import express, { Request, Response } from 'express';
import { getPgPool } from '../utils/db';
import {
  Vendor,
  CreateVendorRequest,
  UpdateVendorRequest,
  VendorsListResponse,
  PaymentTermsType,
  VendorService,
  VENDOR_SERVICES,
} from '@shared/types';

const router = express.Router();

/**
 * Transform a database row to Vendor type
 */
function transformVendorRow(row: Record<string, unknown>): Vendor {
  return {
    id: row.id as number,
    name: row.name as string,
    services: row.services
      ? typeof row.services === 'string'
        ? JSON.parse(row.services as string)
        : row.services
      : null,
    payment_terms_type: row.payment_terms_type as PaymentTermsType,
    payment_terms_custom_days: row.payment_terms_custom_days as number | null,
    invoice_source: row.invoice_source as string | null,
    shipment_type: row.shipment_type as string | null,
    vat_info: row.vat_info as string | null,
    invoice_frequency: row.invoice_frequency as string | null,
    invoice_format: row.invoice_format as string | null,
    payment_method: row.payment_method as string | null,
    is_active: Boolean(row.is_active),
    notes: row.notes as string | null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at as string,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at as string,
    created_by: row.created_by as number | null,
    updated_by: row.updated_by as number | null,
  };
}

/**
 * Validate services array
 */
function validateServices(services: unknown): VendorService[] | null {
  if (!services) return null;
  if (!Array.isArray(services)) return null;
  const validServices = services.filter((s): s is VendorService =>
    VENDOR_SERVICES.includes(s as VendorService)
  );
  return validServices.length > 0 ? validServices : null;
}

/**
 * GET /api/vendors
 * List all vendors with optional search and pagination
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const pool = getPgPool();
    if (!pool) {
      res.status(503).json({ error: 'Database unavailable', timestamp: new Date().toISOString() });
      return;
    }

    const search = (req.query.search as string) || '';
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const includeInactive = req.query.include_inactive === 'true';

    req.log.info({ search, limit, offset, includeInactive }, 'Listing vendors');

    // Build query
    const conditions: string[] = [];
    const params: (string | number | boolean)[] = [];
    let paramIndex = 1;

    if (!includeInactive) {
      conditions.push(`is_active = $${paramIndex++}`);
      params.push(true);
    }

    if (search) {
      conditions.push(`name ILIKE $${paramIndex++}`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM support_logistics_vendors ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Get vendors
    const dataResult = await pool.query(
      `SELECT * FROM support_logistics_vendors
       ${whereClause}
       ORDER BY name ASC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    const vendors = dataResult.rows.map(transformVendorRow);

    const response: VendorsListResponse = {
      vendors,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + vendors.length < total,
      },
    };

    res.json(response);
  } catch (error) {
    req.log.error({ error }, 'Error listing vendors');
    res.status(500).json({
      error: 'Failed to list vendors',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/vendors/:id
 * Get a single vendor by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPgPool();
    if (!pool) {
      res.status(503).json({ error: 'Database unavailable', timestamp: new Date().toISOString() });
      return;
    }

    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({
        error: 'Invalid vendor ID',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ vendorId: id }, 'Fetching vendor');

    const result = await pool.query(
      'SELECT * FROM support_logistics_vendors WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        error: 'Vendor not found',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.json(transformVendorRow(result.rows[0]));
  } catch (error) {
    req.log.error({ error }, 'Error fetching vendor');
    res.status(500).json({
      error: 'Failed to fetch vendor',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/vendors
 * Create a new vendor
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const pool = getPgPool();
    if (!pool) {
      res.status(503).json({ error: 'Database unavailable', timestamp: new Date().toISOString() });
      return;
    }

    const body = req.body as CreateVendorRequest;

    // Validation
    if (!body.name || body.name.trim() === '') {
      res.status(400).json({
        error: 'Missing required field: name',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const name = body.name.trim();

    // Check for duplicate name among active vendors
    const existing = await pool.query(
      'SELECT id FROM support_logistics_vendors WHERE name = $1 AND is_active = true',
      [name]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({
        error: 'A vendor with this name already exists',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ name }, 'Creating vendor');

    // Prepare values
    const services = validateServices(body.services);
    const paymentTermsType = body.payment_terms_type || 'based_on_invoice';
    const paymentTermsCustomDays =
      paymentTermsType === 'custom' ? body.payment_terms_custom_days || null : null;

    const insertResult = await pool.query(
      `INSERT INTO support_logistics_vendors
       (name, services, payment_terms_type, payment_terms_custom_days,
        invoice_source, shipment_type, vat_info, invoice_frequency,
        invoice_format, payment_method, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        name,
        services ? JSON.stringify(services) : null,
        paymentTermsType,
        paymentTermsCustomDays,
        body.invoice_source || null,
        body.shipment_type || null,
        body.vat_info || null,
        body.invoice_frequency || null,
        body.invoice_format || null,
        body.payment_method || null,
        body.notes || null,
        body.created_by || null,
      ]
    );

    const vendor = transformVendorRow(insertResult.rows[0]);

    req.log.info({ vendorId: vendor.id, name: vendor.name }, 'Vendor created');

    res.status(201).json(vendor);
  } catch (error) {
    req.log.error({ error }, 'Error creating vendor');
    res.status(500).json({
      error: 'Failed to create vendor',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * PATCH /api/vendors/:id
 * Update a vendor
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPgPool();
    if (!pool) {
      res.status(503).json({ error: 'Database unavailable', timestamp: new Date().toISOString() });
      return;
    }

    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({
        error: 'Invalid vendor ID',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const body = req.body as UpdateVendorRequest;

    // Check if vendor exists
    const existing = await pool.query(
      'SELECT * FROM support_logistics_vendors WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({
        error: 'Vendor not found',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // If updating name, check for duplicates
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (name === '') {
        res.status(400).json({
          error: 'Name cannot be empty',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const duplicates = await pool.query(
        'SELECT id FROM support_logistics_vendors WHERE name = $1 AND is_active = true AND id != $2',
        [name, id]
      );

      if (duplicates.rows.length > 0) {
        res.status(409).json({
          error: 'A vendor with this name already exists',
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }

    req.log.info({ vendorId: id, updates: Object.keys(body) }, 'Updating vendor');

    // Build dynamic update query
    const updates: string[] = [];
    const values: (string | number | boolean | null)[] = [];
    let paramIndex = 1;

    if (body.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(body.name.trim());
      paramIndex++;
    }

    if (body.services !== undefined) {
      updates.push(`services = $${paramIndex++}`);
      const services = validateServices(body.services);
      values.push(services ? JSON.stringify(services) : null);
      paramIndex++;
    }

    if (body.payment_terms_type !== undefined) {
      updates.push(`payment_terms_type = $${paramIndex++}`);
      values.push(body.payment_terms_type);
      paramIndex++;
    }

    if (body.payment_terms_custom_days !== undefined) {
      updates.push(`payment_terms_custom_days = $${paramIndex++}`);
      values.push(body.payment_terms_custom_days);
      paramIndex++;
    }

    if (body.invoice_source !== undefined) {
      updates.push(`invoice_source = $${paramIndex++}`);
      values.push(body.invoice_source);
      paramIndex++;
    }

    if (body.shipment_type !== undefined) {
      updates.push(`shipment_type = $${paramIndex++}`);
      values.push(body.shipment_type);
      paramIndex++;
    }

    if (body.vat_info !== undefined) {
      updates.push(`vat_info = $${paramIndex++}`);
      values.push(body.vat_info);
      paramIndex++;
    }

    if (body.invoice_frequency !== undefined) {
      updates.push(`invoice_frequency = $${paramIndex++}`);
      values.push(body.invoice_frequency);
      paramIndex++;
    }

    if (body.invoice_format !== undefined) {
      updates.push(`invoice_format = $${paramIndex++}`);
      values.push(body.invoice_format);
      paramIndex++;
    }

    if (body.payment_method !== undefined) {
      updates.push(`payment_method = $${paramIndex++}`);
      values.push(body.payment_method);
      paramIndex++;
    }

    if (body.notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(body.notes);
      paramIndex++;
    }

    if (body.updated_by !== undefined) {
      updates.push(`updated_by = $${paramIndex++}`);
      values.push(body.updated_by);
      paramIndex++;
    }

    if (updates.length === 0) {
      res.status(400).json({
        error: 'No fields to update',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Always update updated_at
    updates.push('updated_at = NOW()');

    const updateResult = await pool.query(
      `UPDATE support_logistics_vendors SET ${updates.join(', ')} WHERE id = $${paramIndex++} RETURNING *`,
      [...values, id]
    );

    const vendor = transformVendorRow(updateResult.rows[0]);

    req.log.info({ vendorId: vendor.id, name: vendor.name }, 'Vendor updated');

    res.json(vendor);
  } catch (error) {
    req.log.error({ error }, 'Error updating vendor');
    res.status(500).json({
      error: 'Failed to update vendor',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * DELETE /api/vendors/:id
 * Soft-delete a vendor (set is_active = false)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPgPool();
    if (!pool) {
      res.status(503).json({ error: 'Database unavailable', timestamp: new Date().toISOString() });
      return;
    }

    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({
        error: 'Invalid vendor ID',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Check if vendor exists and is active
    const existing = await pool.query(
      'SELECT * FROM support_logistics_vendors WHERE id = $1 AND is_active = true',
      [id]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({
        error: 'Vendor not found or already deleted',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ vendorId: id }, 'Soft-deleting vendor');

    await pool.query(
      'UPDATE support_logistics_vendors SET is_active = false, updated_at = NOW() WHERE id = $1',
      [id]
    );

    req.log.info({ vendorId: id }, 'Vendor deleted');

    res.json({
      message: 'Vendor deleted successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ error }, 'Error deleting vendor');
    res.status(500).json({
      error: 'Failed to delete vendor',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

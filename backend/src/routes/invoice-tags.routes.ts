/**
 * Invoice Tags Routes
 * Manage tags/labels for logistics invoices
 */

import express, { Request, Response } from 'express';
import * as invoiceTagsService from '../services/invoice-tags.service';

const router = express.Router();

/**
 * GET /api/invoice-tags
 * List all available tags
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    req.log.info('Listing all invoice tags');

    const tags = await invoiceTagsService.getAllTags();

    res.json({ tags });
  } catch (error) {
    req.log.error({ error }, 'Error listing invoice tags');
    res.status(500).json({
      error: 'Failed to list invoice tags',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/invoice-tags
 * Create a new tag
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description, createdBy } = req.body;

    if (!name) {
      res.status(400).json({
        error: 'Missing required field: name',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ name }, 'Creating invoice tag');

    const tag = await invoiceTagsService.createTag({
      name,
      description,
      createdBy,
    });

    res.status(201).json(tag);
  } catch (error) {
    req.log.error({ error }, 'Error creating invoice tag');

    // Check for PostgreSQL unique constraint violation (duplicate tag name)
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505') {
      res.status(409).json({
        error: 'Tag already exists',
        message: `A tag with the name "${req.body.name}" already exists`,
        code: 'DUPLICATE_TAG',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(500).json({
      error: 'Failed to create invoice tag',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * PUT /api/invoice-tags/:id
 * Update a tag
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({
        error: 'Invalid tag ID',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ tagId: id, updates: req.body }, 'Updating invoice tag');

    const tag = await invoiceTagsService.updateTag(id, req.body);

    res.json(tag);
  } catch (error) {
    req.log.error({ error }, 'Error updating invoice tag');

    // Check for PostgreSQL unique constraint violation (duplicate tag name)
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505') {
      res.status(409).json({
        error: 'Tag already exists',
        message: `A tag with the name "${req.body.name}" already exists`,
        code: 'DUPLICATE_TAG',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(500).json({
      error: 'Failed to update invoice tag',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * DELETE /api/invoice-tags/:id
 * Delete a tag (also removes all assignments)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({
        error: 'Invalid tag ID',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ tagId: id }, 'Deleting invoice tag');

    await invoiceTagsService.deleteTag(id);

    res.json({
      message: 'Tag deleted successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ error }, 'Error deleting invoice tag');
    res.status(500).json({
      error: 'Failed to delete invoice tag',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/invoice-tags/invoices/:invoiceId/tags
 * Get all tags assigned to a specific invoice
 */
router.get('/invoices/:invoiceId/tags', async (req: Request, res: Response) => {
  try {
    const invoiceId = parseInt(req.params.invoiceId, 10);

    if (isNaN(invoiceId)) {
      res.status(400).json({
        error: 'Invalid invoice ID',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ invoiceId }, 'Fetching tags for invoice');

    const tags = await invoiceTagsService.getTagsForInvoice(invoiceId);

    res.json({ tags });
  } catch (error) {
    req.log.error({ error }, 'Error fetching invoice tags');
    res.status(500).json({
      error: 'Failed to fetch invoice tags',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/invoice-tags/invoices/:invoiceId/tags
 * Assign a tag to an invoice
 */
router.post('/invoices/:invoiceId/tags', async (req: Request, res: Response) => {
  try {
    const invoiceId = parseInt(req.params.invoiceId, 10);
    const { tagId, assignedBy } = req.body;

    if (isNaN(invoiceId)) {
      res.status(400).json({
        error: 'Invalid invoice ID',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!tagId) {
      res.status(400).json({
        error: 'Missing required field: tagId',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ invoiceId, tagId, assignedBy }, 'Assigning tag to invoice');

    const assignment = await invoiceTagsService.assignTagToInvoice(
      invoiceId,
      tagId,
      assignedBy || null
    );

    res.status(201).json(assignment);
  } catch (error) {
    req.log.error({ error }, 'Error assigning tag to invoice');
    res.status(500).json({
      error: 'Failed to assign tag to invoice',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * DELETE /api/invoice-tags/invoices/:invoiceId/tags/:tagId
 * Remove a tag from an invoice
 */
router.delete('/invoices/:invoiceId/tags/:tagId', async (req: Request, res: Response) => {
  try {
    const invoiceId = parseInt(req.params.invoiceId, 10);
    const tagId = parseInt(req.params.tagId, 10);

    if (isNaN(invoiceId) || isNaN(tagId)) {
      res.status(400).json({
        error: 'Invalid invoice ID or tag ID',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.log.info({ invoiceId, tagId }, 'Removing tag from invoice');

    await invoiceTagsService.removeTagFromInvoice(invoiceId, tagId);

    res.json({
      message: 'Tag removed from invoice successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ error }, 'Error removing tag from invoice');
    res.status(500).json({
      error: 'Failed to remove tag from invoice',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

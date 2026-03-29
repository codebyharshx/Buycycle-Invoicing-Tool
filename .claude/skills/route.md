# /route - Create Backend Express Route

Create a new Express.js route handler.

## Usage
```
/route <route-name>
```

## Instructions

When creating a route:

1. **Location**: `backend/src/routes/<route-name>.routes.ts`

2. **Route pattern**:
```ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger';
import * as service from '../services/<service-name>.service';

const router = Router();

// Validation schemas
const createSchema = z.object({
  field1: z.string(),
  field2: z.number().optional(),
});

const updateSchema = createSchema.partial();

/**
 * GET /api/<route-name>
 * List all items
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const items = await service.getItems();
    res.json({ success: true, data: items });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Failed to get items');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/<route-name>/:id
 * Get single item by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }

    const item = await service.getItemById(id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    res.json({ success: true, data: item });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Failed to get item');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/<route-name>
 * Create new item
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const validated = createSchema.parse(req.body);
    const id = await service.createItem(validated);
    res.status(201).json({ success: true, data: { id } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors
      });
    }
    logger.error({ error: (error as Error).message }, 'Failed to create item');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PUT /api/<route-name>/:id
 * Update item
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }

    const validated = updateSchema.parse(req.body);
    const updated = await service.updateItem(id, validated);

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors
      });
    }
    logger.error({ error: (error as Error).message }, 'Failed to update item');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /api/<route-name>/:id
 * Delete item
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID' });
    }

    const deleted = await service.deleteItem(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Failed to delete item');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
```

3. **Register route in main app**:
```ts
import yourRoutes from './routes/<route-name>.routes';
app.use('/api/<route-name>', yourRoutes);
```

4. **Patterns to follow**:
   - Use Zod for request validation
   - Consistent response shape: `{ success, data?, error? }`
   - Parse numeric params with `parseInt()`
   - Validate ID before queries
   - Log errors with context
   - Use appropriate HTTP status codes

# /service - Create Backend Service

Create a new backend service following Express.js patterns.

## Usage
```
/service <service-name>
```

## Instructions

When creating a service:

1. **Location**: `backend/src/services/<service-name>.service.ts` or `backend/src/services/<service-name>/index.ts`

2. **Service pattern**:
```ts
import { logsPool } from '../utils/db';
import { logger } from '../utils/logger';
import { RowDataPacket } from 'mysql2';
import type { YourType } from '@shared/types';

/**
 * Service description
 */

export async function getItems(): Promise<YourType[]> {
  const [rows] = await logsPool.query<RowDataPacket[]>(
    `SELECT * FROM table_name WHERE condition = ?`,
    [value]
  );
  return rows as YourType[];
}

export async function getItemById(id: number): Promise<YourType | null> {
  const [rows] = await logsPool.query<RowDataPacket[]>(
    `SELECT * FROM table_name WHERE id = ?`,
    [id]
  );
  return rows.length > 0 ? (rows[0] as YourType) : null;
}

export async function createItem(data: Partial<YourType>): Promise<number> {
  const [result] = await logsPool.query(
    `INSERT INTO table_name (field1, field2) VALUES (?, ?)`,
    [data.field1, data.field2]
  );
  const insertId = (result as { insertId: number }).insertId;
  logger.info({ id: insertId }, 'Created new item');
  return insertId;
}

export async function updateItem(id: number, data: Partial<YourType>): Promise<boolean> {
  const [result] = await logsPool.query(
    `UPDATE table_name SET field1 = ?, updated_at = NOW() WHERE id = ?`,
    [data.field1, id]
  );
  const affectedRows = (result as { affectedRows: number }).affectedRows;
  return affectedRows > 0;
}

export async function deleteItem(id: number): Promise<boolean> {
  const [result] = await logsPool.query(
    `DELETE FROM table_name WHERE id = ?`,
    [id]
  );
  const affectedRows = (result as { affectedRows: number }).affectedRows;
  return affectedRows > 0;
}
```

3. **Database utilities**:
   - `logsPool` - Main MySQL connection pool
   - Use parameterized queries to prevent SQL injection
   - Type cast results with `as RowDataPacket[]`

4. **Logging**:
   - Use Pino logger from `../utils/logger`
   - Log important operations with context: `logger.info({ id }, 'message')`
   - Log errors: `logger.error({ error: err.message }, 'Failed to...')`

5. **Error handling**:
   - Let errors bubble up to route handlers
   - Log errors before throwing
   - Use descriptive error messages

6. **After creating service**:
   - Create corresponding route in `backend/src/routes/<service-name>.routes.ts`
   - Register route in main Express app

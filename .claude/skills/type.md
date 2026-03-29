# /type - Create or Update Shared Types

Create or update TypeScript type definitions in the shared types package.

## Usage
```
/type <type-name> [--file <filename>]
```

## Instructions

When creating/updating types:

1. **Location**: `shared/types/src/<filename>.ts`
   - `invoice-ocr.ts` - Invoice extraction types
   - `invoice-tags.ts` - Tag types
   - `invoice-data-source.ts` - Data source types
   - `vendor.ts` - Vendor types
   - `database-rows.ts` - Raw database row types

2. **Type patterns**:
```ts
/**
 * Brief description of the type
 */
export interface TypeName {
  /** Field description */
  field: string;
  /** Optional field */
  optionalField?: number;
}

/**
 * Enum-like union types
 */
export type Status = 'pending' | 'approved' | 'rejected';

/**
 * Constants array (when you need runtime values)
 */
export const STATUSES: Status[] = ['pending', 'approved', 'rejected'];
```

3. **Export from index**:
   - Add export to `shared/types/src/index.ts`:
   ```ts
   export * from './your-file';
   ```

4. **Naming conventions**:
   - Interfaces: PascalCase with descriptive name
   - Types: PascalCase
   - Constants: UPPER_SNAKE_CASE

5. **Database types**:
   - Match column names exactly (snake_case)
   - Use `| null` for nullable columns
   - Document with JSDoc comments

6. **Request/Response types**:
   - Suffix with `Request` or `Response`
   - Example: `InvoiceExtractionRequest`, `InvoiceExtractionResponse`

7. **After creating types**:
   - Run `npm run build` in `shared/types/` to compile
   - Import in frontend/backend as `@shared/types`

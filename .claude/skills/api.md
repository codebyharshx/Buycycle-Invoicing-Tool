# /api - Create API Route

Create a new API route following Next.js App Router conventions.

## Usage
```
/api <path> [--method GET|POST|PUT|DELETE|PATCH]
```

## Instructions

When creating an API route:

1. **Location**: `frontend/app/api/<path>/route.ts`

2. **File structure**:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Request validation schema
const requestSchema = z.object({
  // ... fields
});

// Response type (optional but recommended)
interface ApiResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    // ... handle request

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = requestSchema.parse(body);
    // ... handle request

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    console.error('API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

3. **Dynamic routes**: Use `[param]` folder naming
   - `frontend/app/api/invoices/[id]/route.ts`
   - Access via `params.id` in handler

4. **Patterns to follow**:
   - Always use Zod for request validation
   - Return consistent response shape `{ success, data?, error? }`
   - Handle errors with appropriate status codes
   - Log errors to console
   - Import types from `@shared/types`

5. **For backend proxy routes**:
   - Use Axios to call backend Express API
   - Forward authentication headers
   - Handle backend errors gracefully

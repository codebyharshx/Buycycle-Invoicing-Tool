# /test - Run Tests

Run tests for the project using Vitest.

## Usage
```
/test [frontend|backend|all] [--watch] [--coverage]
```

## Instructions

1. **Run frontend tests**:
```bash
cd frontend && npm test
```

2. **Run backend tests**:
```bash
cd backend && npm test
```

3. **Run with watch mode**:
```bash
cd frontend && npm test -- --watch
cd backend && npm test -- --watch
```

4. **Run with coverage**:
```bash
cd frontend && npm test -- --coverage
cd backend && npm test -- --coverage
```

5. **Run specific test file**:
```bash
cd frontend && npm test -- path/to/test.spec.ts
cd backend && npm test -- path/to/test.spec.ts
```

## Test File Patterns

### Frontend (Testing Library + Vitest)
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MyComponent } from './my-component';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('handles click events', async () => {
    const onClick = vi.fn();
    render(<MyComponent onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

### Backend (Supertest + Vitest)
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('GET /api/items', () => {
  it('returns list of items', async () => {
    const response = await request(app)
      .get('/api/items')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('returns 404 for non-existent item', async () => {
    const response = await request(app)
      .get('/api/items/999999')
      .expect(404);

    expect(response.body.success).toBe(false);
  });
});
```

## Test Location Conventions

- Frontend: `frontend/**/*.test.tsx` or `frontend/**/*.spec.tsx`
- Backend: `backend/**/*.test.ts` or `backend/**/*.spec.ts`
- Place tests next to the code they test

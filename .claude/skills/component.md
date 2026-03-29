# /component - Create React Component

Create a new React component following project conventions.

## Usage
```
/component <component-name> [--ui] [--invoice]
```

## Flags
- `--ui` - Create in `frontend/components/ui/` (shadcn/ui style primitive)
- `--invoice` - Create in `frontend/components/invoices/` (invoice-specific component)

## Instructions

When creating a component:

1. **Location**:
   - UI primitives: `frontend/components/ui/<name>.tsx`
   - Invoice components: `frontend/components/invoices/<name>.tsx`
   - General: `frontend/components/<name>.tsx`

2. **File naming**: Use kebab-case (e.g., `invoice-table.tsx`)

3. **Component pattern**:
```tsx
'use client';

/**
 * <ComponentName> Component
 * Brief description of what it does
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface <ComponentName>Props {
  className?: string;
  // ... other props
}

export function <ComponentName>({ className, ...props }: <ComponentName>Props) {
  return (
    <div className={cn("base-classes", className)}>
      {/* content */}
    </div>
  );
}
```

4. **Required imports**:
   - Always import `cn` from `@/lib/utils` for className merging
   - Use Radix UI primitives from `@radix-ui/react-*`
   - Use shadcn/ui components from `@/components/ui/*`
   - Use Lucide icons from `lucide-react`

5. **Styling**:
   - Use Tailwind CSS classes
   - Support `className` prop for customization
   - Use `class-variance-authority` for variants

6. **For UI primitives** (--ui flag):
   - Follow shadcn/ui patterns
   - Export via `displayName` for DevTools
   - Use `React.forwardRef` when needed

7. **For invoice components** (--invoice flag):
   - Import types from `@shared/types`
   - Use TanStack Table for data tables
   - Use React Query for data fetching

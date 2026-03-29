# Buycycle Invoicing Tool

An invoice management system for logistics/shipping companies with multi-model AI OCR extraction, vendor management, and accounting views.

## Tech Stack

### Frontend (`frontend/`)
- **Framework**: Next.js 15 (App Router), React 19
- **Components**: Radix UI + shadcn/ui (class-variance-authority, clsx, tailwind-merge)
- **Icons**: Lucide React, React Icons
- **Styling**: Tailwind CSS 4, tw-animate-css
- **State/Data**: TanStack React Query, TanStack React Table
- **Forms**: React Hook Form + Zod validation
- **Rich Text**: TipTap
- **Other**: dnd-kit, cmdk, date-fns, Axios, Clerk (auth), Sonner (toasts)

### Backend (`backend/`)
- **Framework**: Express.js
- **Databases**: mysql2 (4 pools), pg (PostgreSQL/Railway), ioredis (Redis), lru-cache
- **File Processing**: Multer, Sharp, pdf-lib/pdf-parse/pdfjs-dist, ExcelJS
- **Logging**: Pino
- **Other**: Zod, Resend (email), Stripe, Axios

### Shared (`shared/types/`)
- Shared TypeScript type definitions for frontend and backend

### Testing
- Vitest (both), Testing Library (frontend), Supertest (backend)

## Project Structure

```
├── frontend/                    # Next.js 15 App Router
│   ├── app/                     # App Router pages and API routes
│   │   ├── api/                 # API route handlers
│   │   │   ├── invoice-ocr/     # Invoice extraction endpoints
│   │   │   ├── invoice-tags/    # Tag management
│   │   │   ├── invoice-data-sources/ # Email ingestion config
│   │   │   ├── invoices/        # Invoice CRUD
│   │   │   └── vendors/         # Vendor management
│   │   └── dashboard/           # Dashboard pages
│   │       └── invoices/        # Invoice UI pages
│   ├── components/              # React components
│   │   ├── ui/                  # shadcn/ui primitives
│   │   └── invoices/            # Invoice-specific components
│   └── lib/                     # Utilities and API clients
│
├── backend/                     # Express.js API server
│   └── src/
│       ├── routes/              # Express route handlers
│       ├── services/            # Business logic
│       │   └── invoice-ocr/     # OCR extraction service
│       │       ├── extractors/  # AI model extractors (Claude, Gemini, Mistral, etc.)
│       │       └── parsers/     # CSV parsers for different vendors
│       └── utils/               # Database connections, logging
│
├── shared/types/                # Shared TypeScript definitions
│   └── src/
│       ├── invoice-ocr.ts       # Invoice types
│       ├── invoice-tags.ts      # Tag types
│       ├── invoice-data-source.ts # Data source types
│       └── vendor.ts            # Vendor types
│
└── docs/                        # Documentation
```

## Key Patterns

### Frontend Components
- Use shadcn/ui component patterns with Radix UI primitives
- Components in `frontend/components/ui/` follow shadcn/ui conventions
- Use `cn()` helper from `@/lib/utils` for className merging
- Toast notifications via Sonner
- Forms with React Hook Form + Zod schemas

```tsx
// Example component pattern
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface MyComponentProps {
  className?: string;
  // ... props
}

export function MyComponent({ className, ...props }: MyComponentProps) {
  return (
    <div className={cn("base-classes", className)}>
      {/* content */}
    </div>
  );
}
```

### API Routes (Frontend)
- Located in `frontend/app/api/`
- Follow Next.js App Router conventions
- Export named functions: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`
- Use Zod for request validation

```ts
// Example API route
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({ /* ... */ });

export async function POST(request: NextRequest) {
  const body = await request.json();
  const validated = schema.parse(body);
  // ... handle request
  return NextResponse.json({ success: true });
}
```

### Backend Services
- Services in `backend/src/services/`
- Routes in `backend/src/routes/`
- Use Pino logger from `backend/src/utils/logger`
- Database pools in `backend/src/utils/db`

### Shared Types
- Import from `@shared/types` in both frontend and backend
- Define interfaces in `shared/types/src/`
- Export via `shared/types/src/index.ts`

## Invoice OCR System

The system uses multiple AI models for invoice extraction with consensus analysis:

1. **Primary Models**: Gemini, DeepSeek, Mistral
2. **Fallback Strategy**: Smart fallback - stops when confidence >= 90%
3. **Consensus**: Multi-pass analysis compares results across models
4. **Hybrid Mode**: PDF header + CSV line items for supported vendors (UPS, DHL, GLS, etc.)

### Supported Vendors
- UPS, DHL, FedEx, GLS, Hive, EuroSender, Sendcloud, MRW

### CSV Parsers
- Located in `backend/src/services/invoice-ocr/parsers/`
- Vendor-specific parsing logic for line items

## Database Schema

### Main Tables (PostgreSQL/Railway)
- `invoice_extractions` - Invoice header data
- `invoice_line_items` - Individual shipment line items
- `invoice_tags` / `invoice_tag_assignments` - Tag system
- `invoice_data_sources` / `invoice_data_source_logs` - Email ingestion
- `support_logistics_vendors` - Vendor definitions

### Key Enums
- **status**: `pending`, `processing`, `review`, `approved`, `on_hold`, `rejected`
- **payment_status**: `unpaid`, `partial`, `paid`, `refunded`
- **document_type**: `shipping_invoice`, `credit_note`, `surcharge_invoice`, `correction`, `proforma`
- **line_item_type**: `shipment`, `surcharge`, `credit`, `adjustment`, `fee`

## Development Commands

```bash
# Install dependencies
npm install               # Root (if monorepo scripts)
cd frontend && npm install
cd backend && npm install

# Start development
cd frontend && npm run dev     # Next.js dev server (port 3000)
cd backend && npm run dev      # Express dev server

# Run tests
cd frontend && npm test
cd backend && npm test

# Type checking
cd frontend && npm run typecheck
cd backend && npm run typecheck

# Linting
cd frontend && npm run lint
cd backend && npm run lint
```

## Environment Variables

### Backend
```
NEON_POSTGRES_URL=        # PostgreSQL connection
MYSQL_HOST=               # MySQL connection
MYSQL_USER=
MYSQL_PASSWORD=
AWS_ACCESS_KEY_ID=        # S3 storage
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=
GEMINI_API_KEY=           # AI extraction
MISTRAL_API_KEY=
OPENROUTER_API_KEY=       # Claude via OpenRouter
REPLICATE_API_KEY=        # DeepSeek via Replicate
SENDGRID_API_KEY=         # Email ingestion
```

### Frontend
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
```

## Important Files

- `shared/types/src/invoice-ocr.ts` - Core invoice types
- `backend/src/services/invoice-ocr/index.ts` - Main extraction logic
- `backend/src/services/invoice-ocr/consensus-multipass.ts` - Consensus algorithm
- `frontend/components/invoices/invoice-table.tsx` - Main invoice list
- `docs/INVOICE_TABLES_SCHEMA.md` - Database schema documentation
- `docs/INVOICE_SYSTEM_FUNCTIONALITIES.md` - Feature documentation

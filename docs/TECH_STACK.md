# Tech Stack

## Frontend

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 15 (App Router), React 19 |
| **UI Components** | Radix UI + shadcn/ui |
| **Styling** | Tailwind CSS 4, tw-animate-css |
| **State Management** | TanStack React Query |
| **Tables** | TanStack React Table |
| **Forms** | React Hook Form + Zod validation |
| **Rich Text Editor** | TipTap |
| **Icons** | Lucide React, React Icons |
| **Auth** | Clerk |
| **HTTP Client** | Axios |
| **Toasts** | Sonner |
| **Utilities** | date-fns, dnd-kit (drag/drop), cmdk (command palette) |

## Backend

| Category | Technology |
|----------|------------|
| **Framework** | Express.js |
| **PostgreSQL** | pg (Railway/Neon) |
| **MySQL** | mysql2 (4 connection pools) |
| **Caching** | ioredis (Redis), lru-cache |
| **Logging** | Pino |
| **Validation** | Zod |
| **File Processing** | Multer, Sharp (images), pdf-lib/pdf-parse/pdfjs-dist (PDFs), ExcelJS |
| **Email** | Resend |
| **Payments** | Stripe |
| **HTTP Client** | Axios |

## Shared

| Category | Technology |
|----------|------------|
| **Types** | TypeScript definitions in `shared/types/` |
| **Testing** | Vitest (both), Testing Library (frontend), Supertest (backend) |

## AI/OCR Extractors

The invoice OCR system uses multiple AI models:

- Gemini
- Claude (via OpenRouter)
- Mistral
- DeepSeek (via Replicate)

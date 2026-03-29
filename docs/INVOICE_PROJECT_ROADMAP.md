# Invoice System - Project Roadmap

## Major Tasks

| # | Task | Description | Timeline |
|---|------|-------------|----------|
| 1 | Repository Setup | Create monorepo (frontend, backend, shared), TypeScript, ESLint | |
| 2 | Database Setup | PostgreSQL (Neon) + MySQL schema, migrations | |
| 3 | AWS S3 Setup | Bucket, IAM, upload/download service | |
| 4 | Authentication | JWT backend + NextAuth.js frontend, login/register pages | |
| 5 | AI/OCR Integration | Gemini, Mistral, DeepSeek, Claude extractors | |
| 6 | CSV Parsers | UPS, DHL, GLS, Hive, Eurosender, Sendcloud parsers | |
| 7 | Invoice APIs | CRUD, upload, line items, linking, workflow | |
| 8 | Accounting APIs | Summary, vendor breakdown, monthly pivot, export | |
| 9 | Frontend Core | Invoice list, detail, upload pages | |
| 10 | Frontend Advanced | Accounting dashboard, charts, consolidated views | |
| 11 | Email Ingestion | SendGrid webhook, data sources, auto-processing | |
| 12 | Testing | Unit, integration, E2E tests | |
| 13 | Deployment | Vercel (frontend) + Railway (backend), monitoring | |

---

## Environment Variables

```env
# Database
NEON_POSTGRES_URL=
MYSQL_HOST=
MYSQL_USER=
MYSQL_PASSWORD=

# AWS
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=

# Auth
JWT_SECRET=
NEXTAUTH_SECRET=

# AI
GEMINI_API_KEY=
MISTRAL_API_KEY=
OPENROUTER_API_KEY=
REPLICATE_API_KEY=

# Email
SENDGRID_API_KEY=
```

---

**Last Updated**: 2026-03-22

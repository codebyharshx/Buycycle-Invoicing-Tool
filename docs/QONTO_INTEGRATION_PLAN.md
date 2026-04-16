# Qonto Payment Integration Plan

## Overview
Integrate Qonto banking API to enable direct invoice payments from the invoicing tool. When the logistics team approves invoices, the finance team can pay them directly through Qonto without leaving the application.

---

## How It Will Work (Step-by-Step Flow)

### User Flow
1. **Logistics team** reviews and approves invoice (existing flow)
2. Invoice status changes to `approved`
3. **Finance team (admin only)** sees approved invoices in a "Ready to Pay" queue
4. Finance user clicks "Pay with Qonto" on an invoice
5. System looks up vendor → Qonto beneficiary mapping
6. If no mapping exists, prompts user to select beneficiary from Qonto
7. System creates SEPA transfer via Qonto API (trusted beneficiaries skip SCA)
8. Payment status updates to `processing`
9. Webhook receives transfer status updates
10. When settled, payment_status changes to `paid`

---

## Qonto API Integration Details

### Authentication Options
| Method | Use Case | Our Choice |
|--------|----------|------------|
| API Key | Server-to-server, read operations | For reading account balances |
| OAuth 2.0 | User-initiated actions, payments | **Required for payments** |

### Required OAuth Scopes
- `payment.write` - Create SEPA transfers
- `organization.read` - List accounts, view balances
- `beneficiary.trust` - Trust beneficiaries for faster payments

### Key Endpoints
| Endpoint | Purpose |
|----------|---------|
| `POST /v2/sepa/transfers` | Create SEPA transfer |
| `POST /v2/sepa/payee/verify` | Verify payee before transfer |
| `GET /v2/organization` | Get organization details |
| `GET /v2/organization/bank_accounts` | List bank accounts |
| `POST /v2/webhooks` | Register for payment status updates |

### SEPA Transfer Requirements
```typescript
{
  vop_proof_token: string;        // From payee verification
  transfer: {
    beneficiary_id?: string;      // OR provide beneficiary object
    beneficiary?: {
      name: string;
      iban: string;
      bic?: string;
    };
    bank_account_id: string;      // Source account UUID
    reference: string;            // Max 140 chars (invoice number)
    amount: string;               // Decimal format "1234.56"
    note?: string;
    scheduled_date?: string;      // YYYY-MM-DD
    attachment_ids?: string[];    // Required if amount > 30,000 EUR
  }
}
```

### MCP Server (Read-Only)
- Official MCP: `qonto/qonto-mcp-server` - For AI-assisted queries only
- Supports: Account info, transactions, balances
- Does NOT support: Creating transfers (must use REST API)

---

## Implementation Plan

### Vendor → Beneficiary Mapping (Simplified Approach)

Instead of extracting IBANs from invoices, we'll use **existing Qonto beneficiaries**:

1. **Fetch beneficiaries** from Qonto API (`GET /v2/organization/beneficiaries`)
2. **Match vendor** by name (e.g., "UPS" → Qonto beneficiary "UPS Deutschland")
3. **Store mapping** in `vendor_qonto_mappings` table for quick lookup

Benefits:
- No IBAN storage in our system (security)
- Uses trusted beneficiaries (faster payments, no SCA required)
- Beneficiaries managed in Qonto dashboard

---

### Phase 1: Database Schema Changes

**New table: `qonto_connections`**
```sql
CREATE TABLE qonto_connections (
  id SERIAL PRIMARY KEY,
  organization_id VARCHAR(255) UNIQUE NOT NULL,
  access_token TEXT NOT NULL,           -- Encrypted
  refresh_token TEXT NOT NULL,          -- Encrypted
  token_expires_at TIMESTAMPTZ NOT NULL,
  default_bank_account_id VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**New table: `qonto_payments`**
```sql
CREATE TABLE qonto_payments (
  id SERIAL PRIMARY KEY,
  invoice_extraction_id INTEGER REFERENCES invoice_extractions(id),
  qonto_transfer_id VARCHAR(255),
  status VARCHAR(50) NOT NULL,          -- pending, processing, settled, declined, canceled
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'EUR',
  beneficiary_iban VARCHAR(34) NOT NULL,
  beneficiary_name VARCHAR(255) NOT NULL,
  reference VARCHAR(140) NOT NULL,
  scheduled_date DATE,
  error_message TEXT,
  initiated_by INTEGER REFERENCES invoice_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**New table: `vendor_qonto_mappings`**
```sql
CREATE TABLE vendor_qonto_mappings (
  id SERIAL PRIMARY KEY,
  vendor_name VARCHAR(255) NOT NULL,        -- e.g., "UPS", "DHL"
  qonto_beneficiary_id VARCHAR(255) NOT NULL,
  qonto_beneficiary_name VARCHAR(255),      -- Cached for display
  is_trusted BOOLEAN DEFAULT FALSE,         -- Trusted = no SCA required
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vendor_name)
);
```

This table maps invoice vendors to Qonto beneficiaries. When paying an invoice from "UPS", we look up the corresponding Qonto beneficiary_id.

### Phase 2: Backend Services

**Files to Create:**

1. **`backend/src/services/qonto.service.ts`**
   - OAuth flow (authorize, token exchange, refresh)
   - SEPA transfer creation
   - Payee verification
   - Account/balance fetching
   - Token encryption/decryption

2. **`backend/src/routes/qonto.routes.ts`**
   - `GET /api/qonto/auth/url` - Get OAuth authorization URL
   - `GET /api/qonto/auth/callback` - OAuth callback handler
   - `GET /api/qonto/status` - Check connection status
   - `GET /api/qonto/accounts` - List connected bank accounts
   - `GET /api/qonto/balance` - Get account balance
   - `GET /api/qonto/beneficiaries` - List Qonto beneficiaries
   - `POST /api/qonto/pay/:invoiceId` - Initiate payment
   - `GET /api/qonto/payments/:id` - Get payment status
   - `POST /api/qonto/webhooks` - Receive Qonto webhooks
   - `GET /api/qonto/vendor-mappings` - List vendor→beneficiary mappings
   - `POST /api/qonto/vendor-mappings` - Create/update mapping
   - `DELETE /api/qonto/vendor-mappings/:id` - Remove mapping

3. **`backend/src/services/qonto-webhook.service.ts`**
   - Webhook signature verification
   - Payment status update handling
   - Auto-update invoice payment_status

### Phase 3: Frontend Components

**Files to Create:**

1. **`frontend/components/invoices/qonto-pay-button.tsx`**
   - "Pay with Qonto" button
   - Pre-payment validation
   - SCA flow handling (iframe/redirect)
   - Loading/error states

2. **`frontend/components/invoices/payment-status-badge.tsx`**
   - Visual indicator of Qonto payment status
   - Shows: pending, processing, settled, failed

3. **`frontend/app/dashboard/settings/qonto/page.tsx`**
   - Qonto connection setup (OAuth authorization flow)
   - Select default bank account for payments
   - View connection status
   - **Vendor Mappings Tab**: Map carriers (UPS, DHL, etc.) to Qonto beneficiaries

4. **`frontend/app/api/qonto/[...path]/route.ts`**
   - API proxy routes to backend

**Files to Modify:**

1. **`frontend/app/dashboard/invoices/[id]/page.tsx`**
   - Add QontoPayButton in approved state (admin only)
   - Show Qonto payment status badge
   - Show mapped beneficiary name if available

2. **`frontend/app/dashboard/invoices/page.tsx`**
   - Add "Ready to Pay" filter
   - Show Qonto payment status column

### Phase 4: Environment Variables

```env
# Backend
QONTO_CLIENT_ID=your-oauth-client-id
QONTO_CLIENT_SECRET=your-oauth-client-secret
QONTO_REDIRECT_URI=https://your-app.com/api/qonto/auth/callback
QONTO_WEBHOOK_SECRET=webhook-signing-secret
QONTO_API_URL=https://thirdparty.qonto.com
ENCRYPTION_KEY=32-byte-key-for-token-encryption
```

---

## Security Considerations

1. **Token Storage**: Encrypt OAuth tokens at rest using AES-256
2. **Webhook Verification**: Validate Qonto signature on all webhooks
3. **Idempotency**: Use UUID idempotency keys to prevent duplicate payments
4. **Amount Validation**: Double-check amounts match invoice before payment
5. **Audit Trail**: Log all payment actions with user ID and timestamp
6. **Role Check**: Only `admin` role users can initiate payments
7. **SCA**: Support Strong Customer Authentication for compliance

---

## File Paths Summary

### New Files
- `backend/src/services/qonto.service.ts`
- `backend/src/services/qonto-webhook.service.ts`
- `backend/src/routes/qonto.routes.ts`
- `frontend/components/invoices/qonto-pay-button.tsx`
- `frontend/components/invoices/payment-status-badge.tsx`
- `frontend/app/dashboard/settings/qonto/page.tsx`
- `frontend/app/api/qonto/[...path]/route.ts`

### Modified Files
- `backend/src/server.ts` - Mount qonto routes
- `frontend/app/dashboard/invoices/[id]/page.tsx` - Add pay button
- `frontend/app/dashboard/invoices/page.tsx` - Add payment status column
- `shared/types/src/index.ts` - Export new types
- `docs/INVOICE_TABLES_SCHEMA.md` - Document new tables

### Reuse Existing
- `backend/src/utils/db.ts` - getPgPool()
- `backend/src/utils/logger.ts` - Pino logger
- `frontend/lib/api.ts` - Add qontoApi methods
- `frontend/components/ui/*` - shadcn components

---

## Verification Plan

### Manual Testing
1. Connect Qonto account via OAuth flow
2. Create vendor → beneficiary mapping (e.g., UPS → Qonto beneficiary)
3. View approved invoice from mapped vendor
4. Click "Pay with Qonto"
5. Verify transfer appears in Qonto dashboard
6. Check webhook updates payment status to `paid`

### Test Cases
1. OAuth flow - authorize, token refresh
2. Payment with mapped trusted beneficiary (no SCA)
3. Payment for unmapped vendor (prompts beneficiary selection)
4. Payment > 30,000 EUR (requires attachment upload)
5. Insufficient funds handling
6. Webhook status updates (processing → settled)
7. Duplicate payment prevention (idempotency key)
8. Vendor mapping CRUD operations

---

## Pre-Requisites (Action Required)

### Get Qonto API Access
Since you're currently using Qonto via dashboard only, you need to apply for API access:

1. **Go to**: Qonto Dashboard → Settings → Integrations → API
2. **Or contact**: Qonto support to enable Business API for your account
3. **You'll receive**: OAuth Client ID and Client Secret
4. **Required plan**: Business or Enterprise (API not available on Solo)

Once you have API credentials, we can proceed with implementation.

---

## User Decisions (Confirmed)

| Decision | Choice |
|----------|--------|
| Payment Mode | Individual (one invoice at a time) |
| Approval Workflow | 2-step: Logistics approves → Finance pays |
| Payment Permission | Admin role only |
| Testing Mode | Production (no sandbox) |

---

## Sources
- [Qonto API Introduction](https://docs.qonto.com/api-reference/introduction)
- [Create SEPA Transfer](https://docs.qonto.com/api-reference/business-api/payments-transfers/sepa-transfers/sepa-transfers/create)
- [Qonto MCP Server](https://github.com/qonto/qonto-mcp-server)
- [Qonto Embed SDK Overview](https://docs.qonto.com/api-reference/sdk-libraries/doc-pages/overview)

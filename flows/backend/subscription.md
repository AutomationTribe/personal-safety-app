# Backend Subscription Flow

## Endpoints

### POST /api/v1/payments/init
Initializes a Paystack transaction and returns the checkout URL.

**Auth:** Bearer token required

**Request body:**
```json
{ "plan": "basic" | "elite" }
```
`plan` is optional — defaults to `"elite"` if omitted.

**Amounts:**
- basic → ₦20,000 → 2,000,000 kobo
- elite → ₦35,000 → 3,500,000 kobo

**Paystack call:**
```
POST https://api.paystack.co/transaction/initialize
Body: { email, amount, currency: "NGN", callback_url, metadata: { user_id, plan } }
```

**Response 200:**
```json
{ "authorization_url": "...", "reference": "...", "access_code": "..." }
```

**Response 400:** `{ "error": "Failed to initialize payment" }`
**Response 401:** `{ "error": "Unauthorized", "code": "AUTH_REQUIRED" }`
**Response 500:** `{ "error": "Payment initialization failed" }`

---

### POST /api/v1/payments/verify
Verifies a completed Paystack transaction. Updates profiles on success.

**Auth:** Bearer token required

**Request body:**
```json
{ "reference": "string" }
```

**Paystack call:**
```
GET https://api.paystack.co/transaction/verify/{reference}
```

**On success:** Writes to `profiles` via service-role client:
```json
{
  "id": "<user_id>",
  "subscription_status": "active",
  "plan": "<basic|elite>",
  "next_billing_date": "<ISO — now + 1 year>"
}
```
Uses `upsert` with `onConflict: 'id'`.

**Response 200:** `{ "success": true, "subscription_status": "active" }`
**Response 400:** `{ "error": "Payment not successful" }`
**Response 401:** Unauthorized
**Response 500:** `{ "error": "Verification request failed" }`

---

### POST /api/v1/payments/trial/start
Activates an 8-day free trial. No card required.

**Auth:** Bearer token required

**Request body:** (none)

**Database write:**
```json
{
  "id": "<user_id>",
  "subscription_status": "trial",
  "plan": "elite",
  "trial_start": "<ISO now>",
  "trial_end": "<ISO now + 8 days>"
}
```
Uses `upsert` with `onConflict: 'id'`.

**Response 200:**
```json
{ "success": true, "trial_end": "<ISO string>" }
```
**Response 401:** Unauthorized
**Response 500:** `{ "error": "Could not start trial" }`

---

### POST /api/v1/payments/webhook
Paystack webhook — safety net for charge.success events.

**No auth header** — validated via HMAC-SHA512 signature (`x-paystack-signature` header).

**Validation:**
```
HMAC-SHA512(rawBody, PAYSTACK_SECRET_KEY) === x-paystack-signature
```
Raw body must be preserved (see app.ts middleware).

**On charge.success:**
- Extract `metadata.user_id` and `metadata.plan`
- Upsert profiles: `{ subscription_status: 'active', plan, next_billing_date: now + 1yr }`

**Response 200:** `{ "received": true }` (always, to prevent Paystack retries)

---

## Database Writes Summary

| Event | Table | Columns Written |
|---|---|---|
| Payment verified | profiles | subscription_status='active', plan, next_billing_date |
| Trial started | profiles | subscription_status='trial', plan='elite', trial_start, trial_end |
| Webhook charge.success | profiles | subscription_status='active', plan, next_billing_date |

---

## Paystack Integration Steps

1. **Init:** POST to Paystack `/transaction/initialize` with amount in kobo, email, callback_url, metadata
2. **Checkout:** Mobile opens `authorization_url` in WebView; user completes card entry on Paystack's hosted page
3. **Callback:** Paystack redirects to `https://hadin.app/payment/callback?reference=xxx`; WebView intercepts navigation to this URL
4. **Verify:** Mobile calls our `/verify` with the reference; we call Paystack `/transaction/verify/{ref}` server-side; check `data.status === 'success'`
5. **Webhook (safety net):** Paystack POSTs `charge.success` to our `/webhook`; we re-apply subscription activation in case mobile verify call failed

## Error Cases

| Error | HTTP | Cause |
|---|---|---|
| Missing auth token | 401 | No Authorization header |
| Invalid token | 401 | Supabase getUser() fails |
| Invalid plan | 400 | plan not in ['basic','elite'] |
| Paystack init rejected | 400 | Paystack returned status:false |
| Payment not successful | 400 | Paystack verify data.status !== 'success' |
| DB upsert fails | 500 | Supabase write error |
| Webhook invalid signature | 401 | HMAC mismatch |

---

## SQL Migrations Required

```sql
-- Add plan column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan text DEFAULT 'free';

-- Add next_billing_date column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS next_billing_date timestamptz;

-- Add trial_start column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_start timestamptz;
```

(trial_end already exists from prior work)

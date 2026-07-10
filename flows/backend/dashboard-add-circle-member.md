# Backend Flow — Add a Circle Member

## Endpoint: POST /api/v1/contacts/notify

Called by mobile (via `CircleService.notifyContactViaSMS`) after a contact is saved to Supabase.
This is the only backend call in the add-circle-member flow.

---

## Authentication

- Requires `Authorization: Bearer <supabase-access-token>` header
- Verified by `requireAuth` middleware (validates JWT via Supabase)
- `userId` extracted from the verified token — never trusted from the request body

---

## Rate Limiting

- Middleware: `notifyRateLimit` applied before handler
- Prevents SMS spam if mobile retries rapidly

---

## Request

```json
POST /api/v1/contacts/notify
Content-Type: application/json
Authorization: Bearer <token>

{
  "contactPhone": "+2348012345678",
  "contactName": "Alice Smith",
  "userName": "Robert Hadin"
}
```

### Schema validation (Zod)
| Field | Type | Rule |
|---|---|---|
| `contactPhone` | string | Must match `/^\+234[789]\d{9}$/` — Nigerian E.164 only |
| `contactName` | string | `min(1)` |
| `userName` | string | `min(1)` |

---

## SMS Content

```
Hi {contactName}, {userName} added you to their Hadin safety circle. You'll be notified if they need help while travelling. hellohadin.netlify.app
```

Example:
```
Hi Alice Smith, Robert Hadin added you to their Hadin safety circle. You'll be notified if they need help while travelling. hellohadin.netlify.app
```

---

## Africa's Talking Integration

- Called via `sendSMS(contactPhone, message)` in `backend/src/services/africastalking.ts`
- Uses direct `fetch()` to `https://api.africastalking.com/version1/messaging` — NOT the AT SDK
- Header: `apiKey: <AT_API_KEY>` (camelCase — AT SDK bug sends lowercase `apikey`)
- Sender ID: `AT_SENDER_ID` env var (optional; omitted if not set)
- Phone must already be E.164 Nigerian (`+234…`) before reaching this function — backend re-validates

---

## Response

### Success
```json
HTTP 200
{ "success": true, "messageId": "ATXXXxxxxxxxx" }
```

### Validation error
```json
HTTP 400
{ "error": "Must be a Nigerian E.164 number", "code": "VALIDATION_ERROR" }
```

### SMS delivery failure
```json
HTTP 500
{ "error": "<AT status message>", "code": "SMS_FAILED" }
```

---

## Failure handling (mobile side)

The mobile fires this request **fire-and-forget** — the contact is saved to Supabase regardless of SMS outcome.
If the backend returns an error, `notifyContactViaSMS` logs a `console.warn` in DEV and swallows the error.
The user sees "Member Added Successfully" either way.

---

## What is written to Supabase

The backend does **not** write to Supabase — the mobile writes the contact directly via the Supabase client (RLS enforced via `auth.uid()`).

The backend's only job is to send the welcome SMS via Africa's Talking.

---

## Removed route (production)

`POST /api/v1/contacts/notify-test` — removed. This was a dev-only route with no auth
and no rate limiting. It must not exist in production.

---

## Environment variables required

| Var | Description |
|---|---|
| `AT_API_KEY` | Africa's Talking API key (never logged, never sent to mobile) |
| `AT_USERNAME` | Africa's Talking account username |
| `AT_SENDER_ID` | Optional sender ID (alphanumeric, registered with AT) |
| `SUPABASE_URL` | Supabase project URL (for auth middleware) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (backend only — never in mobile) |

# SEC-07 — Rate limit the public SOS acknowledgement endpoint

## What to fix

**File:** `backend/src/routes/sos.ts` (line 386)

`GET /api/v1/sos/ack/:token` is intentionally public (no auth — circle members who aren't Hadin users tap the link). There is currently no rate limiting. The `:token` segment is a UUID acknowledgement token, but the endpoint performs 2–3 Supabase queries (notification lookup, sos_event lookup, profile lookup) before rendering an HTML response. A bot enumerating tokens would generate significant DB load and AT credit consumption.

## Why it matters

Public unauthenticated endpoints with no rate limit are standard DDoS and enumeration targets. Each request triggers multiple DB reads. The token space is UUIDs (secure against guessing), but without a rate limit there is no cost to trying.

## Exact fix

`express-rate-limit` is already a dependency (used in `rateLimit.ts`). Add an IP-based limiter specifically for this route — do not export it from `rateLimit.ts` since it's specific to one endpoint.

**`backend/src/routes/sos.ts` — add import at the top of the file:**
```ts
import rateLimit from 'express-rate-limit';
```

**Define the limiter near the top of the file (after the imports, before any route):**
```ts
const ackRateLimit = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 20,                   // 20 ack taps per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).type('html').send(
      ackHtml('Too many requests', 'Please wait a moment before trying again.'),
    );
  },
});
```

Note: `ackHtml` is defined later in the file. Either move the `ackHtml` function definition above the limiter, or inline the HTML string in the handler. Moving `ackHtml` up is the cleaner option.

**Apply the limiter on the GET `/ack/:token` route — before:**
```ts
router.get(
  '/ack/:token',
  async (req: Request, res: Response): Promise<void> => {
```

**After:**
```ts
router.get(
  '/ack/:token',
  ackRateLimit,
  async (req: Request, res: Response): Promise<void> => {
```

## Files to touch

- `backend/src/routes/sos.ts`

## Test steps

1. Send 21 GET requests to `/api/v1/sos/ack/any-token` from the same IP within 1 minute — the 21st should return HTTP 429 with HTML body containing "Too many requests".
2. The first 20 requests with a valid token should work normally (return 200 HTML or 404 HTML depending on token validity).
3. `cd backend && npx tsc --noEmit` — no type errors.

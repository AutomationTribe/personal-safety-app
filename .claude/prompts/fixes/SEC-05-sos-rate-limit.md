# SEC-05 — Apply `sosRateLimit` middleware to the SOS POST route

## What to fix

**Files:** `backend/src/routes/sos.ts` and `backend/src/middleware/rateLimit.ts`

`sosRateLimit` is exported from `rateLimit.ts` (3 requests per 10 minutes per user) but is never imported or applied in `sos.ts`. The route currently does a manual DB-level rate check (lines 93–104 in `sos.ts`) by querying `sos_events` — but this check runs after auth middleware and a full Supabase round-trip, and it only returns a soft 200 with `rateLimited: true` rather than the HTTP 429 that the middleware would return.

`notifyRateLimit` in `contacts.ts` shows the correct pattern: import the limiter and add it as a middleware argument on the route definition.

## Why it matters

Without express-rate-limit on this route, a bot can spam the SOS endpoint until the DB-level check fires, burning AT SMS credits and creating noise in the monitoring dashboard on every request before the check. The middleware blocks at the HTTP layer before any database call.

Note: the existing DB-level check can remain as a secondary guard — it catches cases where the same user fires from multiple servers/IPs that would otherwise bypass a single-process in-memory rate limiter.

## Exact fix

**`backend/src/routes/sos.ts` — add import:**

Change the existing import block. Before:
```ts
import { requireAuth, AuthRequest } from '../middleware/auth';
```

After:
```ts
import { requireAuth, AuthRequest } from '../middleware/auth';
import { sosRateLimit } from '../middleware/rateLimit';
```

**Apply the middleware on the POST `/` route — before:**
```ts
router.post(
  '/',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
```

**After:**
```ts
router.post(
  '/',
  requireAuth,
  sosRateLimit,
  async (req: Request, res: Response): Promise<void> => {
```

No other changes needed. The `sosRateLimit` middleware already uses `userOrIp` as its key generator, so authenticated users are rate-limited by user ID (matching the existing DB check), and unauthenticated requests that slip past `requireAuth` would be caught by IP.

## Files to touch

- `backend/src/routes/sos.ts`

## Test steps

1. Fire `POST /api/v1/sos` more than 3 times within 10 minutes using the same user token — the 4th request should return HTTP 429 `{ code: 'RATE_LIMITED' }` before any DB query runs (check server logs for absence of a Supabase call).
2. Fire 3 valid SOS requests — all 3 should succeed with 200.
3. Wait 10 minutes (or reset the rate limit store) — the same user should be able to fire again.
4. `cd backend && npx tsc --noEmit` — no type errors.

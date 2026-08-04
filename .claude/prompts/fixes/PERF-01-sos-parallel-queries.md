# PERF-01 — Parallelize independent Supabase reads in the SOS hot path

## What to fix

**File:** `backend/src/routes/sos.ts` (lines 93–260, the `POST /` handler body)

The SOS alert handler executes 5–7 Supabase round-trips **sequentially**. On a Railway instance with a Supabase project in a different region, each round-trip costs 50–150ms. The total before the first SMS is sent can exceed 600ms.

The current sequential order:
1. Rate-check query (`sos_events` count) — depends on nothing
2. Trip lookup (`trips`) — depends on nothing (only needs `tripId` from request)
3. Contacts fetch (`trusted_contacts`) — depends on trip result (needs `contact_ids`)
4. Profile fetch (`profiles`) — depends on nothing (only needs `userId`)
5. SOS event insert (`sos_events`) — depends on contacts + profile
6. Platform phone lookup (`profiles` again) — depends on contacts
7. SOS notifications insert — depends on SOS event + platform phone lookup

Steps 1, 2, and 4 are completely independent of each other and can run in parallel. Step 3 depends on step 2 (needs trip's `contact_ids`), but once step 2 completes steps 3 and 4 can overlap. Step 6 depends on step 3. Steps 5 and 6 can run in parallel once steps 2, 3, and 4 are done.

## Why it matters

SOS is the highest-urgency path in the application. Every 100ms of added latency is 100ms a contact waits to be notified of an emergency. Parallelizing independent reads can cut 200–400ms from the pre-SMS path with zero business logic change.

## Exact fix

Restructure the top of the handler into two parallel phases:

**Phase 1 — all queries that depend only on request data (run together):**
- Rate check
- Trip lookup (if `tripId` is present)
- User profile fetch

**Phase 2 — queries that depend on Phase 1 results:**
- Contacts fetch (needs `trip.contact_ids`)
- (then SOS event insert, platform phone lookup, notifications insert as before)

**Revised handler structure (replace lines 92–185 in `sos.ts`):**

```ts
const { tripId, lat, lng, timestamp, alertLevel, batteryLevel, networkType } = parsed.data;
const userId = (req as AuthRequest).user.id;
const coords = `POINT(${lng} ${lat})`;

// ── Phase 1: parallel independent reads ──────────────────────────────────────
const windowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();

const [rateResult, tripResult, profileResult] = await Promise.all([
  // 1a. Rate check
  supabase
    .from('sos_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('triggered_at', windowStart),

  // 1b. Trip lookup (only if tripId was supplied)
  tripId
    ? supabase
        .from('trips')
        .select('id, contact_ids')
        .eq('id', tripId)
        .eq('user_id', userId)
        .single()
    : Promise.resolve({ data: null, error: null, count: null }),

  // 1c. User profile (for display name in SMS)
  supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .single(),
]);

// Rate limit check
const { count: recentCount } = rateResult;
if ((recentCount ?? 0) >= 5) {
  console.log(`[SOS] Rate limit hit — user=${userId}`);
  res.json({ success: true, rateLimited: true, notified: 0, total: 0 });
  return;
}

// Trip existence check
let trip: { id: string; contact_ids: string[] | null } | null = null;
if (tripId) {
  const { data: tripData, error: tripError } = tripResult;
  if (tripError || !tripData) {
    res.status(404).json({ error: 'Trip not found', code: 'NOT_FOUND' });
    return;
  }
  trip = tripData as { id: string; contact_ids: string[] | null };
}

// Profile / display name
const rawName: string =
  ((profileResult.data as { full_name: string | null } | null)?.full_name) ??
  (req as AuthRequest).user.email ??
  'A Hadin user';
const userName = rawName.slice(0, 20);
```

After this block, the rest of the handler (alertLevel === 2 early return, contacts fetch, SOS event insert, etc.) continues as-is, since those depend on `trip` and `userName` which are now resolved.

Note: the `alertLevel === 2` early-return block (lines 127–157 in the original) should also be moved up to immediately after the rate check, before the contacts/profile work, since level-2 events skip all of that anyway. This avoids the profile fetch for level-2 silent events.

## Files to touch

- `backend/src/routes/sos.ts`

## Test steps

1. Add timing logs around the Phase 1 `Promise.all` call and compare total elapsed time before and after: `console.time('sos-phase1')` / `console.timeEnd('sos-phase1')`.
2. With 3 parallel queries, total Phase 1 time should approach the slowest single query (not the sum of all three).
3. End-to-end test: `POST /api/v1/sos` with a valid trip and contacts — response should be the same shape as before (`{ success, eventId, notified, total }`).
4. Test with `tripId: null` — confirm the trip lookup branch is skipped cleanly and the rate check + profile fetch still run in parallel.
5. Test the level-2 `alertLevel: 2` path — confirm it exits early after the rate check (profile lookup result is not used).
6. `cd backend && npx tsc --noEmit` — no type errors.

## Caution

The `Promise.all` call must be `await`-ed before processing results. Do not use `Promise.allSettled` for Phase 1 — a trip fetch failure must still return 404 synchronously, not be absorbed as a settled rejection.

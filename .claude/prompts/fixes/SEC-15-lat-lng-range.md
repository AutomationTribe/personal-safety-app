# SEC-15 — Add min/max range validation for lat and lng in SOS schema

## What to fix

**File:** `backend/src/routes/sos.ts` (lines 17–30, the `SOSSchema` definition)

```ts
const SOSSchema = z.object({
  tripId: z.string().uuid().nullable().optional(),
  lat: z.number(),
  lng: z.number(),
  // ...
});
```

`lat` and `lng` accept any number, including values outside valid geographic ranges. Supabase's PostGIS `geography` type will throw or silently truncate if handed coordinates outside `[-90, 90]` for latitude or `[-180, 180]` for longitude. Without Zod validation catching this first, invalid coordinates either reach PostGIS (causing a 500 from a DB error) or get stored as garbage data in `sos_events`.

## Why it matters

- A malformed SOS request with `lat: 9999` would fail at the PostGIS insert (after auth, rate limiting, trip lookup, and contacts fetch — all wasted work) and return a 500 instead of a meaningful 400.
- Stored garbage coordinates would appear on the monitoring dashboard map as a point far off the map (or break the map renderer).
- Input validation should reject invalid data at the schema layer, not at the DB layer.

## Exact fix

**`backend/src/routes/sos.ts` — before (lines 17–20 of `SOSSchema`):**
```ts
const SOSSchema = z.object({
  tripId: z.string().uuid().nullable().optional(),
  lat: z.number(),
  lng: z.number(),
```

**After:**
```ts
const SOSSchema = z.object({
  tripId: z.string().uuid().nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
```

No other changes needed. The existing `parsed.success` check at the start of the route handler already returns 400 with `VALIDATION_ERROR` when Zod validation fails, so invalid coordinates will be rejected before any DB call.

## Files to touch

- `backend/src/routes/sos.ts`

## Test steps

1. `POST /api/v1/sos` with `{ lat: 91, lng: 0, timestamp: "..." }` — expect 400 `{ code: 'VALIDATION_ERROR' }`.
2. `POST /api/v1/sos` with `{ lat: 0, lng: 181, timestamp: "..." }` — expect 400.
3. `POST /api/v1/sos` with `{ lat: -90, lng: -180, timestamp: "..." }` — expect the request to proceed past validation (boundary values are valid).
4. `POST /api/v1/sos` with valid Nigerian coordinates e.g. `{ lat: 6.5244, lng: 3.3792, timestamp: "..." }` — expect 200 (normal flow).
5. `cd backend && npx tsc --noEmit` — no type errors.

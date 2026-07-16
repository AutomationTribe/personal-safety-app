# User Mode — Backend Flow

## Location ping ingestion
N/A — handled directly via the Supabase client from mobile (`LocationService.syncPingToSupabase`), same as before. `backend/src/routes/location.ts` stays an unimplemented stub (`501`); this task doesn't change that. Always Online pings go through the identical path with `trip_id: null`.

## Auto-SOS: 1st vs 2nd level alerts

Both levels go through the existing `POST /api/v1/sos` in `backend/src/routes/sos.ts`, extended (not replaced) with an optional `alertLevel` field.

- **1st level** (`alertLevel: 1`, default — unchanged from today): user explicitly confirms "Send SOS alert" from either the main SOS button or the `AreYouOkayModal`. Full existing flow: writes `sos_events` (now with `alert_level = 1`), SMS to every trip contact via Africa's Talking, sets `trips.status = 'sos'`.
- **2nd level** (`alertLevel: 2`): fired automatically by the mobile stop-detector after 60s of no response to `AreYouOkayModal`. Writes `sos_events` with `alert_level = 2`, `contacts_total = 0`, `contacts_notified = 0` — **skips the contacts fetch and SMS loop entirely**, and does **not** update `trips.status` (the trip stays `active`; this is a silent internal check-in, not a circle-facing emergency). The row is still visible to whatever reads `sos_events` for monitoring (e.g. a future dashboard alert queue) — "monitoring center only" is satisfied by *not* SMS-ing the circle, not by a separate table or endpoint.

Request schema addition:
```ts
const SOSSchema = z.object({
  tripId: z.string().uuid(),
  lat: z.number(),
  lng: z.number(),
  timestamp: z.string(),
  alertLevel: z.number().int().min(1).max(2).optional().default(1),
});
```

Mobile side: `SOSService.triggerSilentSOS(tripId)` is a new, separate function from `triggerSOS()` — it posts `alertLevel: 2` and, critically, **does not fall back to opening the native SMS composer if the backend is unreachable**. Reusing `triggerSOS()`'s existing SMS-fallback path for a "silent" alert would defeat the point (it would text the user's personal circle exactly when the design says not to). If the backend can't be reached, the silent check-in is simply dropped — logged locally, no fallback — since there's no way to notify "the monitoring center only" over SMS.

## Mode state stored server-side
N/A — `AsyncStorage` on-device only (`HADIN_USER_MODE:<userId>`), same as the existing Trip Mode/Always On toggle. Nothing server-side needs to know which mode a user is in; it only observes the pings and trips that mode produces.

## Schema changes this task needed (applied via migration `009_user_mode_support.sql`)
- `location_pings.trip_id` — dropped `NOT NULL` (Always Online pings have no trip).
- `sos_events.alert_level smallint NOT NULL DEFAULT 1` + check constraint `IN (1,2)`.
- `trips.destination_lat`, `trips.destination_lng` — nullable, populated by a best-effort mobile-side geocode for arrival detection.

No RLS policy changes were needed — all three tables' existing `auth.uid() = user_id` policies apply unchanged to the new nullable/extra columns.

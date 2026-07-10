# History — Backend Flow

N/A — the History feature reads and writes `trips`, `location_pings` and
`sos_events` directly via the Supabase client from mobile, gated by existing
`auth.uid()` RLS policies on all three tables. No new `/api/v1/*` Express
routes are needed.

## Supabase RPCs added (supabase/migrations/008_history_geo_helpers.sql)

Both are `SECURITY INVOKER` — they run as the calling user, so the existing
RLS policies on `location_pings` and `sos_events` still apply. Added because
PostgREST serializes `geography(Point,4326)` columns as WKB hex by default;
these RPCs do the `ST_X`/`ST_Y` extraction server-side so mobile never has to
parse WKB.

- `get_trip_location_pings(p_trip_id uuid)` → `id, lat, lng, accuracy, speed, heading, created_at`, ordered oldest first. Used by `TripDetailScreen` to draw the route polyline and ping list.
- `get_trip_sos_events(p_trip_id uuid)` → `id, lat, lng, triggered_at, delivery_method, resolved_at, cancelled_at, notes, contacts_total, contacts_notified`, ordered oldest first. Used by `TripDetailScreen` to plot SOS markers and list SOS events tied to a trip.

## Bug found in passing (fixed in the same migration)

`backend/src/routes/sos.ts` has always inserted `contacts_total` and
`contacts_notified` into `sos_events` on the internet SOS path, but no
migration ever added those columns — every SMS-triggered `sos_events` insert
via `/api/v1/sos` was silently failing (Supabase returns an error object,
`sos.ts` only `console.error`s it and keeps going, so the SOS itself and its
SMS still sent — just no history record was ever created). Added both
columns as part of `008_history_geo_helpers.sql` so SOS events actually show
up in History going forward. No route code changed.

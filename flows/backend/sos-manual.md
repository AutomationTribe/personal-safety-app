# SOS (Manual Trigger) — Backend Flow

Source: `flows/General/general.md` — "SOS (manual trigger)". Implemented in
`backend/src/routes/sos.ts`, `backend/src/services/africastalking.ts`
(existing, unchanged), `backend/src/services/email.ts` (new).

## `POST /api/v1/sos`

Auth: `requireAuth` (Bearer JWT).

**Request body** (`SOSSchema`):
```ts
{
  tripId?: string | null;  // uuid, or null/omitted for a trip-less (idle-dashboard) SOS
  lat: number;
  lng: number;
  timestamp: string;       // ISO 8601
  alertLevel?: 1 | 2;      // default 1 — 2 is the mobile stop-detector's silent check-in, unrelated to the 60s auto-escalation below
}
```

**Response** (always `200`, even on partial SMS/email failure):
```ts
{ success: true, eventId?: string, notified: number, total: number }
// or, rate-limited:
{ success: true, rateLimited: true, notified: 0, total: 0 }
```

**Error cases**:
- `400 VALIDATION_ERROR` — malformed body.
- `404 NOT_FOUND` — `tripId` given but doesn't belong to this user.
- Rate limit: max 5 SOS events per user per 10 minutes — silently returns
  `{ success: true, rateLimited: true, ... }` rather than an error status
  (an attacker/bug spamming SOS shouldn't get a signal to probe against,
  and the mobile client already has its own SMS fallback for this case).

### Handler steps (level-1, the circle-facing alert)

1. Rate-limit check (`sos_events` count in the last 10 min).
2. If `tripId` given: verify the trip belongs to this user (404 if not).
   If omitted: proceed with no trip context.
3. Resolve contacts:
   - With a trip: `trusted_contacts` rows matching `trip.contact_ids`.
   - Without a trip: every `trusted_contacts` row for the user with
     `notify_on_sos = true` (same fallback the mobile client's offline path
     uses in `SOSService.getSOSContacts`).
4. Resolve the user's display name (`profiles.full_name`, falling back to
   their auth email, truncated to 20 chars).
5. **Insert `sos_events` immediately** — before attempting any SMS/email —
   so the event exists even if delivery subsequently fails entirely.
   `coords` is now populated (`POINT(lng lat)`, same WKT convention as
   `location_pings`) — previously received in the request but silently
   never persisted, a pre-existing bug fixed as part of this pass.
6. Schedule the 60s no-response auto-escalation (see below).
7. Build the SMS/email body (see exact text below).
8. `Promise.allSettled` over all contacts — for each, send SMS
   (Africa's Talking) and, if the contact has an `email` on file, send
   email (Resend) in parallel. One contact's failure never blocks another;
   SMS failure for one contact doesn't skip that contact's email attempt.
9. Update `sos_events.contacts_notified` with the actual SMS-success count
   (`notified` in the response mirrors this — email delivery is
   best-effort on top and doesn't affect this count, matching the mobile
   UI's existing "Contacts reached: X of Y" contract).
10. If tied to a trip: flip `trips.status = 'sos'`. Skipped entirely for a
    trip-less SOS.

### Level-2 payload (`alertLevel: 2`)

Unrelated to the 60s escalation below — this is the mobile stop-detector's
existing silent "are you okay, no response in 60s" check-in
(`triggerSilentSOS` in `SOSService.ts`, already built in an earlier pass).
Inserts a `sos_events` row with `alert_level: 2`, `contacts_total: 0`,
skips the contacts/SMS/email loop entirely, never touches `trips.status`.

## Exact SMS text (and email body — identical)

```
SOS alert from {userName}. His last know location is {lat}, {lng} ({mapsUrl}) - Hadin (https://hadin.app)
```
where `{mapsUrl}` is `https://maps.google.com/?q={lat},{lng}`.

Example: `"SOS alert from Ada Obi. His last know location is 6.5244, 3.3792 (https://maps.google.com/?q=6.5244,3.3792) - Hadin (https://hadin.app)"`
— 135 characters for a typical name, still inside a single SMS segment
(160 chars) after `userName` is truncated to 20 chars (148 chars
worst-case). Shows the raw coordinates *and* a tappable maps link *and* a
link to hadin.app, per explicit approval of this exact wording. "His" is
not gender-conditional — it's the literal copy specified for this pass,
applied regardless of the user's actual gender.

## 1st-level alert delivery

- **SMS**: `sendSMS()` in `africastalking.ts` — direct `fetch()` to
  `https://api.africastalking.com/version1/messaging`, no SDK, per
  CLAUDE.md. Unchanged this pass.
- **Email** (new, `backend/src/services/email.ts`): direct `fetch()` to
  Resend's API (`https://api.resend.com/emails`), no SDK — same pattern as
  the SMS service. Requires `RESEND_API_KEY` (and optionally `EMAIL_FROM`,
  defaults to `Hadin Safety <alerts@hadin.app>`) in the backend's
  environment. **Not currently configured** — see "Blocked" below. With no
  key set, `sendEmail()` logs a warning and returns
  `{ success: false, error: 'Email not configured' }` per-contact; this
  never fails the request or blocks SMS.
- **Monitoring center**: no separate "notify" call — `sos_events` already
  has `ALTER PUBLICATION supabase_realtime ADD TABLE public.sos_events`
  from migration 005. Every insert/update (including the 60s escalation
  below) is picked up automatically by any dashboard subscribed via
  `postgres_changes`. No dashboard code exists in this repo to verify
  against — flagged as an assumption.

## `sos_events` — final column set

No new columns were added this pass — the existing live schema already
covers everything the spec asked for, just under different names than
requested (PostGIS `coords` instead of separate `lat`/`lng` floats, per
CLAUDE.md's "All location data stored as PostGIS geography type" rule; no
separate `status` column since `cancelled_at`/`resolved_at` nullability
already encodes active/cancelled/resolved, mirroring how `trips` itself
avoids a derived-state anti-pattern elsewhere):

```sql
id                uuid primary key default gen_random_uuid()
trip_id           uuid references trips(id) on delete cascade, nullable  -- made nullable this pass (migration 011)
user_id           uuid not null references auth.users(id) on delete cascade
coords            geography(Point, 4326), nullable                       -- now actually populated (was a pre-existing bug)
triggered_at      timestamptz not null default now()
delivery_method   sos_delivery_method ('internet' | 'sms' | 'both')      -- level-1 now inserts 'both' (SMS + email attempted)
resolved_at       timestamptz, nullable
resolved_by       text, nullable
notes             text, nullable
created_at        timestamptz not null default now()
cancelled_at      timestamptz, nullable
contacts_total    integer not null default 0
contacts_notified integer not null default 0
alert_level       smallint not null default 1, check (alert_level in (1, 2))
```

## Migrations applied this pass

`supabase/migrations/010_sos_audio_storage.sql`:
```sql
insert into storage.buckets (id, name, public)
values ('sos-audio', 'sos-audio', false)
on conflict (id) do nothing;

create policy "Users can upload SOS audio to their own events"
on storage.objects for insert
with check (
  bucket_id = 'sos-audio'
  and exists (
    select 1 from public.sos_events se
    where se.id::text = (storage.foldername(name))[1]
      and se.user_id = auth.uid()
  )
);

create policy "Users can read their own SOS audio"
on storage.objects for select
using (
  bucket_id = 'sos-audio'
  and exists (
    select 1 from public.sos_events se
    where se.id::text = (storage.foldername(name))[1]
      and se.user_id = auth.uid()
  )
);
```

`supabase/migrations/011_sos_events_trip_id_nullable.sql`:
```sql
alter table public.sos_events alter column trip_id drop not null;
```

Both already applied live via Supabase MCP (project `dskrnyavzfiruyjhfeke`),
not just written to disk.

**Known gap**: Storage RLS only grants the uploading user read/write access
to their own SOS audio. A monitoring-center dashboard would need to read
audio for *other* users' active SOS events — that access would go through
the backend's service-role key (bypasses RLS entirely, per CLAUDE.md
"Service role key ONLY in backend"), not a new RLS policy. No such
dashboard endpoint exists in this repo — out of scope for this pass, since
no dashboard code was provided to extend.

## 2nd-level alert (60s no-response auto-escalation)

Implemented as a plain in-process `setTimeout(..., 60_000)` scheduled
immediately after a level-1 `sos_events` row is inserted (per the flow
spec's own suggestion: "Implement as a setTimeout on the backend"). After
60s, if the row is still `cancelled_at IS NULL AND resolved_at IS NULL`
and `alert_level < 2`, it's updated to `alert_level = 2`. No new SMS/email
fires — the monitoring center's Realtime subscription picks up the
`alert_level` change on the existing row automatically.

**Caveat, explicitly flagged**: this is *not* a durable job. If the
backend process restarts or redeploys within that 60s window (Railway
does this on every deploy, and can on crash-recovery), the timer is lost
and that specific SOS event never escalates. Acceptable for a single-
instance MVP at current scale, but the honest fix — a Supabase Edge
Function on a cron schedule, or a `pg_cron` job checking for
`triggered_at < now() - interval '60 seconds' AND alert_level = 1 AND
cancelled_at IS NULL AND resolved_at IS NULL` — was not built this pass
per the spec's own "setTimeout" suggestion, but should be revisited before
relying on this in production.

## SOS pin cancel

`PATCH /api/v1/sos/:id/cancel` — unchanged this pass (already existed and
worked correctly): sets `cancelled_at = now()` guarded by `cancelled_at IS
NULL` (idempotent — a second cancel attempt 404s rather than double-firing
anything). The monitoring center learns of the cancellation the same way
as everything else here — the Realtime subscription on `sos_events`.

**Bug fixed in this pass**: the response previously returned the created
event's id as `sosEventId`, but the mobile client
(`SOSService.triggerSOS`) has always read `body.eventId` — a key mismatch
that meant `sosEventId` was silently `undefined` on every trigger, so the
mobile "Cancel SOS" PIN flow could never have actually functioned (there
was no id to cancel). Both the level-1 and level-2 response payloads now
return `eventId` to match.

## Audio chunk upload endpoint

Not built as a separate backend endpoint — chunks upload directly from the
mobile client to Supabase Storage via the `supabase-js` client SDK (RLS
policies above), the same pattern the app already uses for every other
piece of user data (trips, contacts, location pings). No backend route
needed.

## Offline SMS fallback

- Mobile detects offline via `@react-native-community/netinfo` and opens
  the native SMS composer immediately, pre-filled to the circle — this was
  already built and unchanged.
- Backend involvement: none at trigger time (mobile never reaches the
  backend while offline, by definition). The mobile client now separately
  queues the event in a local SQLite table and replays it against this
  same `POST /api/v1/sos` endpoint once connectivity returns
  (`SOSService.syncQueuedSOS()`) — from the backend's perspective this is
  indistinguishable from a normal, slightly-delayed trigger.

## Blocked / needs a decision

**Email is not actually sending** — `RESEND_API_KEY` isn't set in the
backend's environment (no email provider was configured anywhere in this
project before this pass; `trusted_contacts.email` exists in the DB and is
collected at add-contact time, but nothing ever sent to it). The code path
is fully wired and will start working the moment a key is added — it just
needs:
1. A Resend account + API key (or tell me to swap in a different provider
   — the `sendEmail()` function is a 20-line isolated module, easy to
   repoint).
2. `RESEND_API_KEY` (and optionally `EMAIL_FROM`, must be a domain you've
   verified with Resend) added to the backend's environment (Railway env
   vars).

Until then, email sends fail silently (logged, never surfaced to the
user or blocking SMS) — SOS delivery itself is unaffected.

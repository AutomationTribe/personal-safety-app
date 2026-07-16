# History — SOS Alerts Flow

Source: `flows/General/general.md` — "History" ("this page shows sos alerts
and trips. it has a filter and search functionality and also a delete
functionality") plus `flows/mobile/sos-manual.md`. This doc supersedes the
SOS-specific sections of `flows/mobile/history.md` (which said "no SOS
detail screen exists" and "no `trigger_type`/`alert_level` columns" — both
are now built; `history.md` still owns the trip-row/TripDetail spec
unchanged).

Screen: `mobile/src/screens/routes/RoutesScreen.tsx` (unchanged file, SOS
row extended — trips list, filters, search, delete stayed as-is). New
screen: `mobile/src/screens/sos/SOSDetailScreen.tsx`.

## Where SOS events appear

Same list as trips, in the existing "All" / "Trips" / "SOS events" filter
tabs on `RoutesScreen` — not a separate tab bar destination. "All"
interleaves both kinds sorted newest-first by `trip.created_at` /
`sos_events.triggered_at`. "SOS events" shows only `sos_events` rows.

## SOS row (list)

- Left icon: Feather `alert-triangle`, `colors.brand.sos` (`#C0392B`), in a
  red-tinted circle — unchanged from the existing row.
- Primary text: `triggered_at` formatted as `9 Jul, 10:32 PM`.
- **Trigger type badge** — amber background regardless of value:
  - `manual` → "Manual" (the SOS button on dashboard/active-trip — the only
    call site that exists today)
  - `trip_auto` → "Trip auto-SOS" (the stop-detector's silent 60s
    no-response check-in, `triggerSilentSOS` — fires automatically during a
    trip, never SMS's the circle, monitoring-center only)
  - `accident` → "Accident" — **no call site produces this today** (no
    crash/accident-detection feature exists in the app); reserved for a
    future feature, see "Blocked" below.
- **Alert level badge**: `alert_level = 1` → "1st level" (red bg),
  `alert_level = 2` → "2nd level" (amber bg).
- **Status badge** (unchanged logic, restyled per spec): `cancelled_at` set
  → "Cancelled" (grey), else `resolved_at` set → "Resolved" (green), else
  → "Active" (red, pulsing dot — reuses the same pulse treatment as the
  active-SOS dashboard card).
- If `trip_id` is set: a small line below the badges — "During trip:
  [origin] → [destination]" — resolved by looking the trip up in the
  `trips` array `RoutesScreen` already has in memory (no extra query).
- Tapping the row navigates to `SOSDetail` with `{ sosId }`.

## Read-only, not deletable

Per general.md's history flow giving trips (not SOS specifically) delete
behaviour, and the existing `flows/mobile/history.md` decision to treat
`sos_events` as an immutable audit trail: **SOS rows have no swipe
actions, no long-press select-mode entry, and are excluded from bulk
delete** even when "Select all" is active in Trips/All tabs (select mode
only ever collects trip ids — unchanged). Deleting the underlying
`sos_events` row itself is not offered anywhere in this pass; only its
**audio recording** can be deleted (see below), which is a privacy
control, not a history-edit control.

## SOS Detail screen (new, full screen — not a bottom sheet)

`mobile/src/screens/sos/SOSDetailScreen.tsx`, route `SOSDetail: { sosId:
string }` in `AppStackParamList`.

- Header: back button (`navigation.goBack()`) + "SOS Alert" title —
  matches `TripDetailScreen`'s back-row pattern for visual consistency.
- **Map** (`react-native-maps`, non-interactive: `scrollEnabled={false}
  zoomEnabled={false} pitchEnabled={false} rotateEnabled={false}`), fixed
  200px height, single red `Marker` at the event's `lat`/`lng` (extracted
  from the `coords` PostGIS column via the same
  `get_trip_sos_events`-style approach — see backend flow doc for the new
  RPC used). If `coords` is null (pre-`coords`-fix historical rows), the
  map section is skipped and replaced with "Location not recorded for this
  alert."
- **Metadata card**:
  - Triggered: formatted `triggered_at`
  - Resolved: formatted `resolved_at` or "—"
  - Cancelled: formatted `cancelled_at` or "—"
  - Alert level: "1st level" / "2nd level"
  - Delivery: `delivery_method` → "Sent via SMS" / "Sent via internet" /
    "Sent via SMS + internet"
  - Trigger type: "Manual" / "Accident" / "Trip auto-SOS"
- **Circle notified section**: contact **names only** (no phone numbers
  rendered anywhere on this screen, per CLAUDE.md's data-minimization
  posture already applied elsewhere in the app), resolved from
  `sos_events.notified_contact_ids` → `trusted_contacts.name` for those
  ids. Empty state: "No contacts were notified for this alert" (the
  trip-less-SOS-with-zero-circle-members edge case, or a level-2 silent
  event which never notifies anyone).
- **Audio section** — shown only if at least one chunk exists in the
  `sos-audio` bucket under `{sosId}/`:
  - "Recording available" label.
  - Play/pause button (`expo-av`, `Audio.Sound`) — plays chunks
    **sequentially** in filename order (`0.m4a`, `1.m4a`, …) as one
    continuous timeline, advancing to the next chunk on `onPlaybackStatusUpdate`
    `didJustFinish`. Each chunk's playable URL is a short-lived Storage
    **signed URL** (`createSignedUrl`, 5 min expiry), fetched at play time,
    not stored.
  - "Request deletion" button → confirmation is inline (button turns into
    "Tap again to confirm" for 3s, no modal — avoids a second screen for a
    single destructive action) → removes every chunk under `{sosId}/` from
    the `sos-audio` bucket. After deletion: audio section swaps to
    "Recording deleted" text, play button hidden, matches the spec's
    "hide play button" requirement.
  - Not shown at all if no chunks exist (e.g. mic permission was denied at
    trigger time, or `expo-av` wasn't available on that build) — no empty
    state needed here, the whole section just doesn't render.
- **Linked trip row** — only if `trip_id` is set: "View trip" tappable row
  → `navigation.navigate('TripDetail', { tripId })`.

## Empty state (SOS filter tab)

"No SOS alerts. Stay safe." — icon `shield`. This **replaces** the
existing `flows/mobile/history.md` SOS-tab empty copy ("No SOS alerts. /
You haven't triggered an SOS. That's a good thing.") per this pass's
explicit spec; the title changes, the reassuring tone stays.

## Pull-to-refresh

Unchanged — `RoutesScreen`'s existing `RefreshControl` already re-runs
both the `trips` and `sos_events` queries together; no per-tab refresh
needed since both queries always run.

## Realtime

Unchanged — `RoutesScreen` already has a `postgres_changes` subscription
on `sos_events` (`event: '*'`) from the SOS-manual-trigger pass, which
already reloads the full list on any insert/update. New SOS events (and
the 60s auto-escalation's `alert_level` flip) already appear without a
manual refresh; this pass didn't need to touch that subscription.

## Blocked / needs a decision

- **"Accident" trigger type has no producer.** The `sos_trigger_type` enum
  and badge support it, but no accident/crash-detection feature exists
  anywhere in the codebase (`deviationEngine.ts` is an empty stub). Every
  SOS event today is either `manual` (the SOS button) or `trip_auto` (the
  stop-detector's silent check-in). Flagging in case this was assumed
  already built.
- **"Circle notified" for pre-this-pass SOS events is empty.** The two
  existing `sos_events` rows in the live DB predate the
  `notified_contact_ids` column (defaults to `'{}'`), so their detail
  screen will show the "No contacts were notified" empty state even though
  contacts likely *were* SMS'd at the time (the count was tracked, just not
  which contacts). Only new SOS events going forward will show real names
  here.
- **Audio chunk ordering assumes lexical filename sort works as
  chronological order** (`0.m4a` < `1.m4a` < … < `9.m4a` < `10.m4a` would
  sort wrong past 9 chunks — `10.m4a` sorts before `2.m4a`
  lexically). Fixed by numeric-sorting the listed filenames client-side
  rather than trusting Storage's `list()` order — done in
  `SOSDetailScreen`, not a `sos-audio` naming change, since renaming
  already-uploaded chunks isn't practical.

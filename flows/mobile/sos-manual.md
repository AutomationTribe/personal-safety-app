# SOS (Manual Trigger) — Mobile Flow

Source: `flows/General/general.md` — "SOS (manual trigger)". Implemented in
`mobile/src/screens/trip/HomeScreen.tsx` (UI + state), `mobile/src/services/SOSService.ts`
(trigger/cancel/offline-queue logic), `mobile/src/services/SOSAudioService.ts`
(audio recording).

## SOS button placement

| Screen | Location | Style |
|---|---|---|
| Dashboard (idle) | Red FAB (`✱ SOS`) in the map's control column, bottom-right of the map card | `styles.sosFab` — 55×55 circle, `#DC1F1F` |
| Active Trip | `atStyles.sosBtn` — full-width action button in the action cluster, alongside "Arrived" | `colors.brand.sos` fill, white `home`/`x-circle` Feather icon |

Both call `setShowSOSCountdown(true)` — SOS never fires on tap.

## Confirm/cancel — 20s countdown overlay

Per general.md: tapping SOS opens a **full-screen transparent red overlay**
(`SOSCountdownOverlay`, `HomeScreen.tsx`) with a 20-second countdown
(`SOS_COUNTDOWN_SECONDS = 20`), not a plain confirm/cancel bottom sheet —
this was already built and matches the source-of-truth spec exactly, so it
was kept as-is per "do not rewrite what works."

- **Title**: "Emergency SOS" · **Sub**: "Alerting your emergency contacts in…"
- Large countdown ring (progress arc + pulsing halo), current-location card
  underneath (reverse-geocoded from `lastPing`, or "Getting your live
  coordinates" while resolving).
- **Confirm SOS** button — fires immediately, does not wait for the timer.
- **Cancel** button — dismisses the overlay, nothing happens (no alert
  fired, no one notified).
- **Timer reaches 0** — auto-fires exactly like tapping Confirm.
- On success: overlay switches to a "Help is on the way" success state
  (green check, "Return to Dashboard" button) instead of just closing.

## On confirm

1. `SOSService.triggerSOS(tripId, contactIds)` — `tripId` is the active
   trip's id, or **`null`** for a dashboard-idle SOS (see "Trip-less SOS"
   below).
2. GPS fix acquired at `Location.Accuracy.High` (non-negotiable for SOS,
   separate from the app's general accuracy-gated map/tracking fixes).
3. POSTs to `POST /api/v1/sos` — backend inserts the `sos_events` row,
   sends SMS + email to circle contacts, schedules the 60s escalation.
4. On success: `sosActive = true`, `sosEventId` stored,
   `SOSAudioService.startSOSRecording(eventId)` begins rolling 30s-chunk
   audio recording in the background.
5. On failure (offline, backend unreachable, or non-OK): falls back to
   opening the native SMS composer pre-filled to the circle (existing
   behaviour, unchanged) — audio recording is **not** started for this
   path (no `eventId` to attach chunks to).

The spec's "app minimises immediately" step was intentionally **not**
built — there's no product reason to force-background the app on SOS (the
countdown/success UI itself is the point of staying in-app), and doing so
would fight the OS's own back-gesture/app-switcher behaviour for no
benefit. Audio recording runs regardless of foreground/background state
(`staysActiveInBackground: true`), so nothing is lost either way.

## Trip-less SOS (dashboard idle state)

general.md: "Clicking the sos icon in the dashboard/active triggers the sos
mode" — SOS must work with no active trip, not just inside one. This
required two real gaps to be closed:

- `sos_events.trip_id` was `NOT NULL` in the schema — SOS could not
  physically be fired without a trip. Migrated to nullable
  (`supabase/migrations/011_sos_events_trip_id_nullable.sql`).
- `handleSOSCountdownConfirm` previously hard-required `activeTrip` and
  showed an "SOS unavailable" alert otherwise — removed; it now always
  calls through to `handleSOSTap`.
- Contact selection without a trip: backend falls back to every
  `trusted_contacts` row with `notify_on_sos = true` for the user (same
  fallback mirrored in `SOSService.getSOSContacts` for the offline SMS
  path). With a trip, `trip.contact_ids` is used as before, unchanged.
- The dashboard idle view now renders its own SOS-active card
  (mirroring `ActiveTripView`'s existing one) since there's no
  `ActiveTripView` to host it when there's no trip.

## Active SOS state

While `sosActive` is true, both the idle dashboard and the active-trip
screen show a persistent card: pulsing dot, "SOS alert sent", timestamp,
"Contacts reached: X of Y", and a **Cancel SOS** button.

**Reopening the app during an active SOS**: `HomeScreen.loadData()` queries
`sos_events` for the user's most recent row where `cancelled_at IS NULL AND
resolved_at IS NULL`. If found, `sosActive`/`sosEventId`/`sosTime`/
`sosNotified`/`sosTotal` are restored from it and audio recording resumes
(a new recording session under the same `sos_event_id` folder — chunk
numbering restarts from 0, which can overwrite the one in-flight chunk that
was interrupted by the app closing; every other chunk is unaffected). No
dedicated full-screen "ActiveSOSScreen" was built — the existing inline
card (already visible the instant `loadData()` resolves) serves the same
purpose without a redundant screen.

## SOS PIN cancellation

"Cancel SOS" never cancels directly — it opens `SOSCancelPinModal`
(4-digit pin pad, same visual pattern as the first-login PIN-creation step,
`smStyles`/`PIN_PAD` reused as-is):

- Correct PIN (matches `AsyncStorage[HADIN_SOS_PIN]`) → closes the modal,
  calls the backend `PATCH /api/v1/sos/:id/cancel`, stops audio recording,
  clears SOS state.
- Incorrect PIN → inline error "Incorrect pin. Try again.", input clears,
  **modal stays open**.
- **"Forgot PIN?"** — no dedicated reset flow existed to build against, so
  this clears the stored PIN (`AsyncStorage.removeItem`) and reopens the
  existing first-login PIN-creation modal (`SetupModal` step `'pin'`),
  reusing its enter/confirm logic verbatim rather than duplicating it.

## Offline SOS

- `SOSService.triggerSOS` detects `!online` via `checkIsOnline()` before
  attempting the backend POST.
- The existing native-SMS-composer fallback fires immediately either way
  (unchanged) — this is what actually reaches the circle with no internet.
- **New**: the event is additionally written to a SQLite table
  (`sos_queue`, in the same `hadin.db` used by `LocationService`) so the
  backend record (monitoring center visibility, `contacts_notified` count,
  60s escalation) isn't silently lost.
- `SOSService.syncQueuedSOS()` is called automatically the moment
  `useNetworkStatus` transitions from offline → online (`HomeScreen`'s
  `wasOnlineRef` effect) — POSTs each queued row exactly like a live
  trigger, deletes on success, leaves failures queued for the next
  reconnect.
- Toast shown: **"No internet — SOS sent via SMS to your circle"**
  (`toast.title` in `handleSOSTap`'s failure branch, distinguishing this
  from the generic "SOS sent via SMS" shown when online but the backend
  itself was unreachable).

## Audio recording

`mobile/src/services/SOSAudioService.ts`:

- Starts on SOS confirm success, via `startSOSRecording(sosEventId)`.
- Requests `expo-av` microphone permission if not already granted from the
  first-login checklist (`handleAudioEnable` now calls
  `Audio.requestPermissionsAsync()` directly rather than just opening
  system Settings blindly).
- **If permission is denied**: logs a warning and returns — the SOS alert
  itself is never blocked or delayed by this.
- Records in rolling ~30s chunks (`Audio.Recording`,
  `RecordingOptionsPresets.HIGH_QUALITY`), uploading each finished chunk to
  the private `sos-audio` Storage bucket at
  `[sos_event_id]/[chunk_n].m4a` as soon as it's stopped, then immediately
  starts the next chunk — so a chunk is never held in memory longer than
  its own 30s window.
- `staysActiveInBackground: true` — recording continues if the app is
  backgrounded.
- Stops via `stopSOSRecording()` on SOS cancel (PIN-confirmed) — uploads
  the final in-progress chunk before clearing state.
- **Not wired to server-side SOS resolution** (monitoring center marking
  `resolved_at`) — the mobile client has no realtime listener for that yet,
  so recording only stops on local cancel. Flagged as a known gap.

## UI states summary

| State | UI |
|---|---|
| Idle, no SOS | Normal dashboard / active-trip screen |
| Countdown running | `SOSCountdownOverlay` — red full-screen, ring timer |
| SOS active | Persistent status card (idle dashboard **and** active-trip screen) + audio recording running |
| Cancelling | `SOSCancelPinModal` — pin pad, inline error on mismatch |
| Cancelled | Card disappears, toast/state cleared, audio recording stopped |
| Resolved by monitoring center | **Not built** — no realtime listener on `sos_events.resolved_at`; the card will only clear via local PIN-cancel. Flagged as a known gap, not attempted this pass. |
| No internet at trigger | Native SMS composer opens immediately + toast "No internet — SOS sent via SMS to your circle" + event queued in SQLite for backend sync on reconnect |

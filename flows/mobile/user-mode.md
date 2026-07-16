# User Mode — Mobile Flow

Source: `flows/General/general.md` — "User mode" section.

Two modes, mutually exclusive: **Trip Mode** (Basic + Elite) and **Always
Online** (Elite/Trial only). Neither mode auto-starts tracking on its own —
Trip Mode requires an explicit trip; Always Online starts tracking the
moment it's selected (that *is* its tracking).

## Mode toggle (top of `HomeScreen` idle dashboard)

Segmented pill, existing slide-gesture UI in `IdleView` (`mobile/src/screens/trip/HomeScreen.tsx`) — extended, not rebuilt:

| State | Basic | Elite / Trial |
|---|---|---|
| Trip Mode | Toggleable, default | Toggleable |
| Always Online | Disabled — lock icon, "Elite" badge | Toggleable, `colors.brand.primary` fill when active |

- Tapping the disabled Always Online pill on Basic opens `UpgradeSheet` (bottom sheet, not `Alert.alert()`): "Always online is an Elite feature. Upgrade to unlock continuous tracking, Follow me, and Family mode." → "Upgrade now" → `navigation.navigate('Subscription')`.
- Persisted to `AsyncStorage` key `HADIN_USER_MODE:<userId>` (namespaced per user — previously a single global key, which meant two accounts on one device could leak each other's mode preference).
- Default: Trip Mode.
- Switching mode while a trip is active is not reachable — `HomeScreen` renders `ActiveTripView` instead of `IdleView` whenever `trips.status = 'active'`, so the toggle unmounts for the duration of a trip (Trip Mode's own trip continues regardless of what the toggle would otherwise say).

## Trip Mode

### Start trip (`StartTripModal`)
Fields: destination (text, geocoded on submit via `Location.geocodeAsync` — best effort, saved to `trips.destination_lat/lng` if it resolves, silently null if not), **Expected duration (minutes)**, **Stop threshold (minutes, default 10)**, notify-circle (all/select), Auto SOS toggle. Origin is always `'Current location'` (unchanged).

On submit: insert into `trips` (`expected_duration_minutes`, `max_stop_duration_minutes` ← stop threshold, `destination_lat/lng`), call `LocationService.startTracking(trip.id, 30)` (unchanged — battery-optimized 30-min cadence, SQLite-first, exactly as it works today), fire-and-forget the existing `/api/v1/trips/notify-start` SMS.

### Active trip
Unchanged: live stat row, last-known-location card, circle-standby card, manual SOS button, end-trip button — all already built in `ActiveTripView`.

New: a **separate, lightweight foreground watcher** (`watchPositionAsync`, ~50m distance / 60s time trigger) starts alongside `LocationService.startTracking` for the sole purpose of feeding the stop/arrival detectors below. It is *not* the battery-optimized 30-min ping cadence and does not write to `location_pings` — it only updates in-memory detector state. This is a deliberate trade-off: CLAUDE.md's battery-first rule wants 30-min pings, but a 10-min stop threshold cannot be detected on a 30-min cadence. The detector watcher stops the instant the trip ends or the app backgrounds.

### Stop-too-long detection
- Detector tracks an "anchor" position and `lastMovedAt`. Every detector position update that moves >50m from the anchor resets both.
- If `now - lastMovedAt >= stopThresholdMinutes` (from `trips.max_stop_duration_minutes`), show **`AreYouOkayModal`**: "Are you okay? Your trip has been paused." — "I'm fine — continue trip" / "Send SOS alert".
  - "I'm fine" → dismiss, reset anchor + `lastMovedAt = now` (fresh timer).
  - "Send SOS alert" → existing `handleSOSTap()` flow (1st-level alert: circle + monitoring center, unchanged).
  - No response in 60s → auto-fires `SOSService.triggerSilentSOS(tripId)` (2nd-level: monitoring center only, **no circle SMS**), modal dismisses, a brief toast confirms a silent check-in was logged, anchor/`lastMovedAt` reset so it doesn't immediately refire.

### Arrival detection
- Only active when the trip has `destination_lat/lng` (geocode succeeded at trip start).
- Detector computes distance to destination on every position update. Within 50m continuously for 30s (debounced — a single close reading doesn't count) → show **`ArrivalModal`**: "You've arrived at {destination}. End trip?" — Confirm / dismiss.
  - Confirm → `confirmEndTrip()` (existing function — sets `status='completed'`, stops tracking) → **`TripSummaryModal`**.
  - No response in 5 minutes → trip auto-ends silently via the same `confirmEndTrip()` path, `TripSummaryModal` still shown (summary is useful even on a silent auto-end).

### Trip summary (`TripSummaryModal`)
Shown once a trip ends (manual end button, arrival-confirm, or 5-min auto-end): origin, destination, duration (`ended_at - started_at`), distance (haversine sum over `get_trip_location_pings` RPC — same helper `TripDetailScreen` already uses). "Done" closes it, returning to the idle dashboard.

## Always Online (Elite/Trial only)

- Selecting the pill starts a **foreground** `watchPositionAsync` immediately (extends `LocationService.startTracking` to accept `tripId: string | null` — passing `null` writes pings with `location_pings.trip_id = NULL`, `user_id` still set). No trip needed, no trip UI shown.
- Deselecting (switch to Trip Mode) stops it — `LocationService.stopTracking()`.
- Persisted alongside `HADIN_USER_MODE`; resumes automatically on app relaunch if that was the last mode and the plan is still Elite/Trial (checked freshly, since a downgraded plan should not silently keep tracking).
- Banner on `HomeScreen` idle view: "Tracking paused — tap to resume" — shown whenever mode is `'always_on'` but the watcher isn't actually running (location permission revoked, or the watcher failed to start). Tapping re-attempts `Location.getForegroundPermissionsAsync()` then restarts the watcher.
- "App killed by OS → tracking pauses" is **already true by construction** — nothing in this codebase registers a background task for GPS (only `expo-task-manager`/`expo-background-fetch` are installed, unused for location), so a killed app simply stops the JS watcher. Documenting this as expected behaviour rather than something to build.
- **Battery gate** (`mobile/src/services/BatteryMonitor.ts`, `expo-battery`): watches battery level while Always Online is running. At ≤15% → stops tracking, clears the map listener, fires a local notification via `mobile/src/services/NotificationService.ts` ("Hadin tracking paused — low battery. Open the app to resume."), and the idle-dashboard banner switches to "Tracking paused — tap to resume". At >20% → resumes tracking automatically (re-checks location permission first). Hysteresis (15%/20% rather than one cutoff) avoids flapping pause/resume right at the threshold. Local notifications only — no push token/FCM registration, since nothing server-side needs to trigger this.
  - Because a trip attached to the running session (see above) shares the same tracking subscription, a battery-triggered pause also pauses that trip's pings — treated as intentional (a dying phone can't send SOS either way), not a bug.
- Follow Me: gated the same as Always Online (Elite/Trial) per the upgrade-sheet copy, but **no Follow Me feature exists anywhere in the codebase to gate** — paused per explicit instruction, not building it in this pass.

## Plan gating matrix

| Plan / status | Trip Mode | Always Online |
|---|---|---|
| Basic, active | ✅ | ❌ (locked, upgrade sheet) |
| Elite, active | ✅ | ✅ |
| Trial (any plan tier) | ✅ | ✅ — trial is treated as Elite for gating purposes, matching `flows/mobile/dashboard.md`'s existing "Elite / Trial" column |
| Free / expired | Dashboard is unreachable at all (`AppNavigator.resolveInitialRoute` gates to `Subscription`) | — |

`userPlan` is read once per `HomeScreen.loadData()` from `profiles.plan` — unchanged. `subscription_status = 'trial'` is treated as Elite-equivalent for this gate (existing app-wide convention).

## Banners / modals inventory

| State | UI |
|---|---|
| GPS permission off (any mode) | Existing yellow banner: "Location access disabled — tap to re-enable" |
| Always Online selected but watcher not running | New banner: "Tracking paused — tap to resume" |
| Always Online attempted on Basic plan | `UpgradeSheet` bottom sheet |
| Trip Mode: stopped too long | `AreYouOkayModal` |
| Trip Mode: arrived | `ArrivalModal` |
| Trip Mode: trip ended (any path) | `TripSummaryModal` |
| Low battery (≤15%) pause + push notification | Implemented — `BatteryMonitor.ts` + `NotificationService.ts` |

## Known gaps — blocked, need a decision

1. **True background tracking (survives app kill).** Would need `expo-task-manager` wired to `Location.startLocationUpdatesAsync` as a registered background task, which requires a dev/EAS build (Expo Go can't run custom native background tasks). Currently Always Online — and its battery monitor — are foreground-only: both stop the instant the OS kills the app, honestly documented rather than silently claimed as "background." This is the same limitation `expo-notifications` runs into for guaranteed delivery while the app is fully closed.
2. **Follow Me.** No feature exists to gate; the upgrade-sheet copy mentions it (matches the product copy given in the task) but there's nothing behind it yet — paused per explicit instruction.

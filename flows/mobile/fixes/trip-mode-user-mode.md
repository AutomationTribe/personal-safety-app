# Fix — Trip Mode / User Mode Toggle

Source: `flows/fixes.md` — "Clicking trip mode user mode in the dashboard should
not trigger the add a trip mode form, it should just slide to the trip mode
option, activating trip mode and deactivating always on. activating trip mode
means no tracking of user until a trip is set."

## What was broken

Tapping the User Mode segmented pill (top of the idle dashboard, `IdleView` in
`mobile/src/screens/trip/HomeScreen.tsx`) was, in an earlier revision, wired
so the tap handler could fall through to `onStartTrip` (which opens
`StartTripModal` — the "add a trip" form) instead of purely toggling between
Trip Mode and Always Online. The toggle and the "start a trip" action are
conceptually unrelated: the toggle picks a tracking *mode*, the "+" map
control starts a trip *within* Trip Mode. Conflating them meant a user simply
switching back to Trip Mode was unexpectedly interrupted by a trip-creation
form.

## Current state (verified, this pass)

Re-audited `mobile/src/screens/trip/HomeScreen.tsx` end to end. The toggle and
the add-trip action are fully decoupled — no code path connects them:

- The mode-toggle `Pressable` (`styles.modeRow`, ~line 1179) and its
  `modePanResponder` (drag-to-slide) both call **only** `handleModeToggle`.
- `onStartTrip` / `handleStartTrip` / `showStartModal` are wired **only** to
  the "+" (plus-circle) button inside the map's control column (~line 1275),
  a physically and logically separate control.
- All child elements inside the toggle row (`Feather` icons, labels, ELITE
  badge) are `pointerEvents="none"`, so taps anywhere in the pill always
  resolve to the parent `Pressable`/`PanResponder` — no nested-touchable
  conflict that could accidentally route a tap to the wrong handler.

No code change was required to satisfy this fix — the described bug does not
reproduce in the current codebase. This document records the intended
behavior as a regression guard and the exact functions to check if it
resurfaces.

## Affected files / functions

- `mobile/src/screens/trip/HomeScreen.tsx`
  - `IdleView` → `handleModeToggle(mode: UserMode)` — the only function that
    may change `userMode`.
  - `IdleView` → `modePanResponder` — drag-gesture variant of the same
    toggle; resolves to `handleModeToggle` on release.
  - `IdleView` → `handleStartTrip` (passed down from `HomeScreen` as
    `onStartTrip`) — must remain reachable only from the map's "+" control.

## Before / after (as originally fixed)

**Before** (bug): mode-pill `onPress` could resolve into the same handler
tree as `onStartTrip`, so tapping "Trip Mode" while on Always Online risked
opening `StartTripModal` instead of (or in addition to) switching modes.

```tsx
// illustrative — the broken shape being guarded against
<Pressable onPress={() => { onStartTrip(); /* mode switch afterthought */ }}>
  ...
</Pressable>
```

**After** (current, correct):

```tsx
<Pressable
  style={styles.modeRow}
  onLayout={(event) => setModeToggleWidth(event.nativeEvent.layout.width)}
  onPress={(event) => {
    const tapX = event.nativeEvent.locationX;
    void handleModeToggle(tapX < modeToggleWidth / 2 ? 'always_on' : 'trip');
  }}
  {...modePanResponder.panHandlers}
>
  {/* ... */}
</Pressable>
```

`onStartTrip` is passed down and used exclusively by the separate "+" map
control:

```tsx
<Pressable style={styles.mapControlBtn} onPress={onStartTrip} ...>
  <Feather name="plus-circle" size={21} color="#4B0082" />
</Pressable>
```

## Mode toggle behaviour

- **Tap**: `tapX` within the pill determines target mode (left half =
  Always Online, right half = Trip Mode) → `handleModeToggle(mode)`.
- **Drag** (`modePanResponder`): thumb follows the gesture in real time via
  `modeSlide` (`Animated.Value`); on release, projects final position +
  velocity to decide the resting mode, then calls the same
  `handleModeToggle(mode)` — single source of truth, no duplicate logic.
- **Switching to Trip Mode** (`handleModeToggle('trip')`):
  1. Animate thumb to the Trip Mode side.
  2. `setUserMode('trip')`, persist to `AsyncStorage[HADIN_USER_MODE:<userId>]`.
  3. `setPositionListener(null)` — detach the live-map listener.
  4. `stopBatteryMonitor()` — no battery gate needed without Always Online.
  5. `await stopTracking()` — **no GPS pings occur** until the user explicitly
     starts a trip via the "+" control (`StartTripModal` → `startTracking(trip.id, 30)`).
  6. `setAlwaysOnRunning(false)`.
- **Switching to Always Online** (`handleModeToggle('always_on')`):
  1. Elite/Trial only — Basic plan taps open `UpgradeSheet` instead
     (see Plan gating below); mode does not change.
  2. Animate thumb, persist mode.
  3. `startAlwaysOnline()` — checks foreground permission, attaches the map
     position listener, starts `startTracking(null, 1)` (1-minute cadence,
     `trip_id = null` pings), and starts the battery gate.
- **No-op tap** (tapping the already-active side): re-animates the thumb to
  its resting position, no state change, no tracking side effects.

## Plan gating

- Always Online pill is tap-reachable on Basic, but `handleModeToggle`
  intercepts before any state change: `mode === 'always_on' && userPlan ===
  'basic'` → `setShowUpgradeSheet(true)` + snap the thumb back to the current
  mode. `UpgradeSheet` copy: "Always online is an Elite feature. Upgrade to
  unlock continuous tracking, Follow me, and Family mode." → "Upgrade now" →
  `navigation.navigate('Subscription')`.
- Elite and `subscription_status === 'trial'` are both treated as
  Always-Online-eligible (existing app-wide convention, `loadData()` maps
  both to `userPlan = 'elite'`).
- Visual gating in the pill itself: `userPlan === 'basic'` renders a lock
  icon + "ELITE" badge and muted text color on the Always Online segment,
  regardless of drag/tap — the gate is enforced in `handleModeToggle`, the
  visual is just a preview of that gate.

## Mode persistence

- `AsyncStorage` key: `` `HADIN_USER_MODE:${userId}` `` — namespaced per user
  (not a single global key), so two accounts on the same device don't leak
  each other's mode preference.
- Written on every successful `handleModeToggle` mode change.
- Read once per `userId` resolution (`modeStorageKey` effect): restores
  `userMode` and, if the persisted mode is `'always_on'` **and** the current
  plan still allows it, calls `startAlwaysOnline()` automatically. A
  downgraded plan does **not** silently resume tracking — checked fresh
  against `userPlan` on every restore, not cached from when the mode was
  saved.

## Edge cases

| Case | Behaviour |
|---|---|
| Mode switch during an active trip | Unreachable by construction — `HomeScreen` renders `ActiveTripView` (no mode toggle in that tree) whenever `activeTrip` is non-null. The toggle only exists in `IdleView`. Trip Mode's own trip continues regardless of what the toggle would otherwise say. |
| App killed mid-Always-Online | Foreground-only watcher dies with the process (no `expo-task-manager` background registration — see `flows/mobile/user-mode.md` "Known gaps"). On relaunch, the persisted-mode effect re-checks plan and permission and resumes automatically if still eligible. |
| GPS permission off when switching to Always Online | `startAlwaysOnline()` checks `Location.getForegroundPermissionsAsync()`; if not granted, `alwaysOnRunning` stays `false` and the idle dashboard shows "Tracking paused — tap to resume", which retries the same permission check + start on tap. |
| GPS permission revoked *while* Always Online is running | Existing yellow "Location access disabled — tap to re-enable" banner (unrelated to the mode toggle) covers this; the watcher itself will simply stop emitting positions until permission is restored. |
| Downgrade from Elite → Basic while Always Online is active | Not force-stopped mid-session by this fix (out of scope) — but will not silently resume on next relaunch, per the persistence check above. |

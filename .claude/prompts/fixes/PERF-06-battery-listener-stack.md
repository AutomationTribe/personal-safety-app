# PERF-06 — Two battery listeners can stack when a trip is attached to an Always Online session

## What to fix

Two separate battery listeners can be active simultaneously:

1. **Always Online gate** — `startBatteryMonitor()` in `mobile/src/services/BatteryMonitor.ts` attaches `Battery.addBatteryLevelListener` (stored in `_subscription`). Thresholds: pause at ≤15%, resume at >20%.

2. **Trip battery gate** — `startTripBatteryGate()` in `mobile/src/services/LocationService.ts` (lines 317–340) attaches another `Battery.addBatteryLevelListener` (stored in `_tripBatteryListener`). Thresholds: degrade to interval at ≤20%, restore continuous at >25%.

When a user is in Always Online mode (BatteryMonitor running) and then starts a trip, `startTracking()` is called with `mode: 'continuous'`, which calls `startTripBatteryGate()`. Both listeners are now active. On every battery tick:

- The Always Online gate may call `stopTracking()` and `setAlwaysOnRunning(false)` at ≤15%.
- The Trip gate may call `switchTrackingMode('interval')` at ≤20%.

Both fire independently, potentially calling `stopTracking()` and `switchTrackingMode()` within milliseconds of each other at slightly different thresholds. This creates a race: the Always Online gate calls `stopTracking()` while the Trip gate is mid-`switchTrackingMode()`, leaving the tracking state inconsistent.

**Affected locations:**
- `mobile/src/services/BatteryMonitor.ts` — `_subscription`, `startBatteryMonitor`, `stopBatteryMonitor`
- `mobile/src/services/LocationService.ts` — `startTripBatteryGate()` lines 317–340

## Why it matters

Both listeners fire on every battery level tick. Two listeners at slightly different thresholds can call `stopTracking()` / `switchTrackingMode()` in an overlapping sequence, causing the tracking state machine to enter an inconsistent state (e.g. `_isTracking = false` while `_trackingSubscription` is still live). This can prevent pings from being recorded silently — defeating the safety tracking guarantee.

## Exact fix

### Step 1 — Export `isRunning()` from `BatteryMonitor.ts`

Add a public `isRunning()` export so `startTripBatteryGate` can check whether BatteryMonitor is already active before stacking a second listener.

**`mobile/src/services/BatteryMonitor.ts` — add after `stopBatteryMonitor`:**

```ts
/**
 * Returns true if the Always Online battery monitor is currently active.
 * Used by LocationService to skip the trip-level battery gate when the
 * Always Online gate already covers the low-battery scenario.
 */
export function isRunning(): boolean {
  return _subscription !== null;
}
```

### Step 2 — Guard `startTripBatteryGate` in `LocationService.ts`

Import `isRunning` from BatteryMonitor and skip the trip gate when the Always Online monitor is already active.

**Add import at the top of `mobile/src/services/LocationService.ts`:**

```ts
import { isRunning as isBatteryMonitorRunning } from './BatteryMonitor';
```

**Before (lines 317–340 of `LocationService.ts`):**

```ts
async function startTripBatteryGate(): Promise<void> {
  stopTripBatteryGate();
  _tripBatteryDegraded = false;

  try {
    const level = await Battery.getBatteryLevelAsync();
    if (level >= 0 && level <= TRIP_LOW_BATTERY_THRESHOLD) {
      _tripBatteryDegraded = true;
      await switchTrackingMode('interval');
    }

    _tripBatteryListener = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      if (!_tripBatteryDegraded && batteryLevel <= TRIP_LOW_BATTERY_THRESHOLD) {
        _tripBatteryDegraded = true;
        void switchTrackingMode('interval');
      } else if (_tripBatteryDegraded && batteryLevel > TRIP_LOW_BATTERY_RESUME_THRESHOLD) {
        _tripBatteryDegraded = false;
        void switchTrackingMode('continuous');
      }
    });
  } catch {
    // Non-fatal — tracking continues in its current mode without the gate.
  }
}
```

**After:**

```ts
async function startTripBatteryGate(): Promise<void> {
  // If the Always Online battery monitor is already running, it already covers
  // the low-battery scenario (pause at ≤15%). Adding a second listener would
  // cause both gates to fire independently at slightly different thresholds,
  // creating a race between stopTracking() and switchTrackingMode(). Skip the
  // trip gate entirely — the Always Online gate is sufficient.
  if (isBatteryMonitorRunning()) {
    if (__DEV__) console.log('[LocationService] Skipping trip battery gate — Always Online monitor already active');
    return;
  }

  stopTripBatteryGate();
  _tripBatteryDegraded = false;

  try {
    const level = await Battery.getBatteryLevelAsync();
    if (level >= 0 && level <= TRIP_LOW_BATTERY_THRESHOLD) {
      _tripBatteryDegraded = true;
      await switchTrackingMode('interval');
    }

    _tripBatteryListener = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      if (!_tripBatteryDegraded && batteryLevel <= TRIP_LOW_BATTERY_THRESHOLD) {
        _tripBatteryDegraded = true;
        void switchTrackingMode('interval');
      } else if (_tripBatteryDegraded && batteryLevel > TRIP_LOW_BATTERY_RESUME_THRESHOLD) {
        _tripBatteryDegraded = false;
        void switchTrackingMode('continuous');
      }
    });
  } catch {
    // Non-fatal — tracking continues in its current mode without the gate.
  }
}
```

## Files to touch

- `mobile/src/services/BatteryMonitor.ts` — add `isRunning()` export
- `mobile/src/services/LocationService.ts` — import `isBatteryMonitorRunning` and add the guard at the top of `startTripBatteryGate()`

## Test steps

1. Switch to Always Online mode — confirm `BatteryMonitor.isRunning()` returns true (log it in `startAlwaysOnline`).
2. Start a trip while Always Online is active. In Metro logs, confirm `[LocationService] Skipping trip battery gate` is printed.
3. Simulate battery drop to 14% (use the Expo dev menu battery simulator or a physical device). Confirm the Always Online gate fires (`onPause` called, tracking stops, `alwaysOnRunning` goes false). Confirm only ONE `stopTracking` call appears in logs.
4. Start a trip in Trip Mode only (not Always Online). Confirm the trip battery gate DOES start (no skip log). Simulate battery at 19% — confirm `switchTrackingMode('interval')` is called.

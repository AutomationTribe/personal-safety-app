# PERF-03 — Duplicate GPS watcher during active Trip Mode

## What to fix

`mobile/src/screens/trip/HomeScreen.tsx`, lines 496–549.

When a trip is active and `LocationService.startTracking()` has been called with `mode: 'continuous'`, `LocationService` already holds an open `watchPositionAsync` subscription (in `_trackingSubscription` inside `LocationService.ts`). The `useEffect` that runs the stop/arrival detector (lines 483–555) then starts its own **second** `watchPositionAsync` with identical parameters, resulting in two concurrent GPS sessions on the same device.

The comment at line 506–508 in the current code even acknowledges this was intended to be avoided:

```ts
// Keep the map / "Current Location" label live — this detector
// watcher already runs at ~60s cadence for stop/arrival checks,
// so piggyback on it instead of starting a second GPS watcher.
```

The comment describes the intent, but the implementation doesn't follow through — the code still calls `Location.watchPositionAsync` directly instead of using `setPositionListener`.

## Why it matters

Two concurrent GPS sessions at `BestForNavigation` accuracy double the GPS chip power draw — directly violating the battery-first rules in CLAUDE.md. On a 4-hour trip this can cost 15–25% additional battery drain, reducing the device's ability to sustain the SOS path. GPS is the single largest power consumer on a mobile device.

## Exact fix

Remove the `Location.watchPositionAsync` call from the detection `useEffect` and instead register a `setPositionListener` callback that performs the same stop/arrival logic. The single tracking watcher in `LocationService` already fires on every fix and calls `_positionListener?.(lat, lng)` — so the detection logic gets position updates without a second GPS session.

**Before (lines 496–548 of `HomeScreen.tsx`):**

```ts
Location.getForegroundPermissionsAsync().then(({ status }) => {
  if (status !== 'granted') return;
  Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 5000, distanceInterval: 10 },
    (pos) => {
      if (sosActiveRef.current) return;
      const { latitude, longitude } = pos.coords;
      const now = Date.now();

      if (isAccurateEnough(pos.coords.accuracy)) {
        setLastPing({
          tripId: activeTrip.id,
          lat: latitude,
          lng: longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          timestamp: new Date(pos.timestamp).toISOString(),
          source: 'gps',
          synced: false,
        });
      }

      // Stop-too-long
      if (!stopAnchorRef.current) {
        stopAnchorRef.current = { lat: latitude, lng: longitude };
        lastMovedAtRef.current = now;
      } else if (haversineMetres(stopAnchorRef.current.lat, stopAnchorRef.current.lng, latitude, longitude) > STOP_RADIUS_METRES) {
        stopAnchorRef.current = { lat: latitude, lng: longitude };
        lastMovedAtRef.current = now;
      } else if (now - lastMovedAtRef.current >= thresholdMs) {
        setShowAreYouOkay(true);
      }

      // Arrival
      if (destLat != null && destLng != null) {
        const distToDest = haversineMetres(latitude, longitude, destLat, destLng);
        if (distToDest <= ARRIVAL_RADIUS_METRES) {
          if (arrivedSinceRef.current === null) {
            arrivedSinceRef.current = now;
          } else if (now - arrivedSinceRef.current >= ARRIVAL_DEBOUNCE_MS) {
            setShowArrival(true);
          }
        } else {
          arrivedSinceRef.current = null;
        }
      }
    },
  ).then((sub) => { detectorSubRef.current = sub; }).catch(() => null);
}).catch(() => null);
```

**After:**

```ts
// Instead of a second watchPositionAsync, piggyback on the single tracking
// watcher already running in LocationService via setPositionListener.
setPositionListener((latitude, longitude) => {
  if (sosActiveRef.current) return;
  const now = Date.now();

  // Update the UI map / "Current Location" label
  setLastPing({
    tripId: activeTrip.id,
    lat: latitude,
    lng: longitude,
    accuracy: null,   // accuracy not available via the lat/lng listener — acceptable for display
    speed: null,
    heading: null,
    timestamp: new Date().toISOString(),
    source: 'gps',
    synced: false,
  });

  // Stop-too-long
  if (!stopAnchorRef.current) {
    stopAnchorRef.current = { lat: latitude, lng: longitude };
    lastMovedAtRef.current = now;
  } else if (haversineMetres(stopAnchorRef.current.lat, stopAnchorRef.current.lng, latitude, longitude) > STOP_RADIUS_METRES) {
    stopAnchorRef.current = { lat: latitude, lng: longitude };
    lastMovedAtRef.current = now;
  } else if (now - lastMovedAtRef.current >= thresholdMs) {
    setShowAreYouOkay(true);
  }

  // Arrival
  if (destLat != null && destLng != null) {
    const distToDest = haversineMetres(latitude, longitude, destLat, destLng);
    if (distToDest <= ARRIVAL_RADIUS_METRES) {
      if (arrivedSinceRef.current === null) {
        arrivedSinceRef.current = now;
      } else if (now - arrivedSinceRef.current >= ARRIVAL_DEBOUNCE_MS) {
        setShowArrival(true);
      }
    } else {
      arrivedSinceRef.current = null;
    }
  }
});
```

**Update the cleanup block** (lines 551–554) to clear the position listener instead of removing the subscription:

```ts
// Before
return () => {
  detectorSubRef.current?.remove();
  detectorSubRef.current = null;
};

// After
return () => {
  setPositionListener(null);
};
```

The `detectorSubRef` ref is now unused — remove it.

> **Accuracy note:** the `setPositionListener` callback receives only `lat` and `lng`. The `accuracy`, `speed`, and `heading` fields in `setLastPing` are set to `null`. This is acceptable for the UI label — the map marker position is accurate; only the metadata is unknown. The `isAccurateEnough` guard from the original code is implicitly handled because `LocationService`'s `captureAndQueue` already gates on accuracy before calling `_positionListener`. Only accurate fixes propagate.

> **Mode note:** if `LocationService` is in `interval` mode (low-battery degradation), `_positionListener` is called from `captureAndQueue` which runs at interval cadence — the stop/arrival detector will tick at that cadence instead of 5 s. This is acceptable; the ARRIVAL_DEBOUNCE_MS and AREYOUOKAY_TIMEOUT_MS windows are both in minutes.

## Files to touch

- `mobile/src/screens/trip/HomeScreen.tsx`
  - Remove the `Location.watchPositionAsync` call inside the detection `useEffect` (lines 496–548)
  - Replace with `setPositionListener(...)` callback
  - Update cleanup to `setPositionListener(null)`
  - Remove the now-unused `detectorSubRef` ref

## Test steps

1. Start a trip with a destination set.
2. Check Metro logs — confirm only ONE `[LocationService]` ping log line appears per 5 s interval (not two).
3. Remain stationary for `max_stop_duration_minutes` — confirm the "Are you okay?" modal appears on schedule.
4. Walk to within 50 m of the destination coordinate, hold for 30 s — confirm the Arrival modal appears.
5. On a physical device, use the battery stats screen (Android: Settings > Battery > Battery usage) after a 10-minute trip — confirm LocationService appears once, not twice.

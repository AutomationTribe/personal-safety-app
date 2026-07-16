# Fix — Active Trip live map + time elapsed

Source: `flows/fixes.md` — "New Active Trip page":
> a map has been added to the new active trip screen already in the app.
> this map should show the current location of the user during the duration
> of the trip. the current location should show the current location of the
> user from the latest ping. Time elapsed is showed -1 when a trip started
> that should not be possible it should always show 0m. user location on
> map, current location and time elapsed should continue to update in real
> time. every other functionality remains as is.

## What was broken

`ActiveTripView` in `mobile/src/screens/trip/HomeScreen.tsx` (the "Active
Trip" screen shown while `trips.status = 'active'`):

1. **Map was a static remote screenshot**, not a live map — a hardcoded
   Google-hosted image URL (`mapImage`) rendered via `<Image>`. It never
   reflected the traveller's actual position and never updated.
2. **"Current Location" label was static** — `trip.origin?.trim() ||
   'Current location'`, i.e. just the trip's origin string set once at trip
   creation, not the live current position.
3. **Time Elapsed could show "-1m"** — `elapsed` was computed as
   `Date.now() - new Date(trip.created_at).getTime()`, unclamped. If the
   device clock is a few hundred ms behind the server-set `created_at`
   timestamp (common right after insert), `ms` is briefly negative,
   `Math.floor` on a small negative number returns `-1`, and since `h` isn't
   `> 0` the display fell through to `${m}m` = `"-1m"`.
4. **Nothing updated `lastPing` during an active trip** — `HomeScreen`'s
   `lastPing` state was populated once via `getLastPing()` in `loadData()`
   (a one-time SQLite read) and never refreshed while a trip was running, so
   even the existing "Last Known Location" / "Last Updated" detail card was
   effectively frozen at whatever the last ping was before the screen loaded.

## Affected files / functions

- `mobile/src/screens/trip/HomeScreen.tsx`
  - `HomeScreen` → stop/arrival detector effect (the `Location.watchPositionAsync`
    call inside the `useEffect` keyed on `[activeTrip]`, ~line 426–480).
  - `ActiveTripView` — map render block, `elapsed` effect, new
    `currentLocationName` effect.

## Fix

### 1. Real-time `lastPing` during an active trip
The stop/arrival detector already runs a lightweight foreground
`watchPositionAsync` (Balanced accuracy, 60s / 30m trigger) purely to feed the
"Are you okay?" and arrival detectors — deliberately separate from
`LocationService`'s battery-optimized 30-minute ping cadence
(`flows/mobile/user-mode.md`). Rather than start a *third* GPS watcher just
for the map, its callback now also calls `setLastPing(...)` on every fix, so
the map, current-location label, and detail card all ride the same
already-battery-conscious watcher:

```tsx
(pos) => {
  if (sosActiveRef.current) return;
  const { latitude, longitude } = pos.coords;
  const now = Date.now();

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

  // ...existing stop-too-long / arrival logic, unchanged
}
```

### 2. Live map
Replaced the static `<Image>` with a real `react-native-maps` `MapView`,
region-centered on `lastPing` (falling back to the trip's destination, then
Nigeria's default region, if no ping has arrived yet):

```tsx
const mapRegion = lastPing
  ? { latitude: lastPing.lat, longitude: lastPing.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }
  : trip.destination_lat != null && trip.destination_lng != null
    ? { latitude: trip.destination_lat, longitude: trip.destination_lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : NIGERIA_DEFAULT;

<MapView style={atStyles.mapImage} region={mapRegion}>
  {lastPing && <Marker coordinate={{ latitude: lastPing.lat, longitude: lastPing.lng }} title="Current location" pinColor="#0051D5" />}
  {trip.destination_lat != null && trip.destination_lng != null && (
    <Marker coordinate={{ latitude: trip.destination_lat, longitude: trip.destination_lng }} title="Destination" pinColor="#BA1A1A" />
  )}
</MapView>
```

The now-unused static-image styles (`mapShade` overlay, hardcoded `opacity:
0.9`) and the `mapImage` URL constant were removed; the `Image` import was
dropped from `HomeScreen.tsx` since nothing else in the file used it.

### 3. Live "Current Location" label
Reverse-geocoded from `lastPing`, re-resolved whenever the ping's
coordinates change (same pattern `IdleView` already uses for its dashboard
location badge):

```tsx
const [currentLocationName, setCurrentLocationName] = useState(trip.origin?.trim() || 'Locating…');
useEffect(() => {
  if (!lastPing) return;
  Location.reverseGeocodeAsync({ latitude: lastPing.lat, longitude: lastPing.lng })
    .then(([addr]) => {
      if (!addr) return;
      const parts = [addr.city ?? addr.subregion, addr.region].filter(Boolean);
      setCurrentLocationName(parts.join(', ') || 'Current location');
    })
    .catch(() => null);
}, [lastPing?.lat, lastPing?.lng]);
```

### 4. Time Elapsed clamp
```tsx
// before
const ms = Date.now() - new Date(trip.created_at).getTime();

// after
const ms = Math.max(0, Date.now() - new Date(trip.created_at).getTime());
```
`elapsed` now initializes to `'0m'` (was `''`) so there's no flash of an
empty stat before the first `compute()` call resolves, and the recompute
interval was tightened from 60s to 30s so the displayed value tracks reality
more closely (still coarse enough to be battery-irrelevant — it's a
`setInterval` on already-in-memory state, no GPS or network call).

## Everything else unchanged
Stat grid, Arrived/SOS action buttons, SOS status card, "Last Known
Location"/"Last Updated" detail card, tab bar — all untouched. The detail
card's "Last Updated" timestamp now visibly ticks forward as `lastPing`
refreshes, which is existing behavior working correctly now that `lastPing`
is no longer frozen.

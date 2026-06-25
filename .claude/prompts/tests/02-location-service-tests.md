# Prompt: LocationService unit tests

## Agent
QA Engineer — read .claude/agents/qa-engineer.md first.

## Read before writing
- CLAUDE.md
- mobile/src/services/LocationService.ts
- mobile/src/hooks/useNetworkStatus.ts

## Goal
Write mobile/src/__tests__/LocationService.test.ts

## Mocks required
- expo-location: mock requestForegroundPermissionsAsync,
  getCurrentPositionAsync, watchPositionAsync
- expo-sqlite: mock openDatabaseAsync, execAsync,
  runAsync, getAllAsync, getFirstAsync
- ../hooks/useNetworkStatus: mock checkIsOnline
- ../lib/supabase: mock from().insert()

## Test cases required

### Permission handling
- Permission granted: startTracking proceeds
- Permission denied: startTracking throws with
  'Location permission denied. Cannot track trip.'

### startTracking
- Sets _activeTripId correctly
- Resets all stationary detection state on start
- Calls captureAndQueue immediately on start
- Calls watchPositionAsync with Accuracy.Balanced
- Uses timeInterval of intervalMinutes * 60 * 1000
- Uses distanceInterval of 500
- Warns and returns if already tracking

### stopTracking
- Removes the location subscription
- Resets _activeTripId to null
- Resets all stationary detection state

### getCurrentLocation
- Uses Accuracy.High (not Balanced — this is critical)
- Returns correctly shaped LocationPing
- tripId is '' when no active trip

### Stationary detection
- Two pings within 100m: _isStationary becomes true
- Movement >100m resets consecutive count to 0
- getIsStationary() returns correct value
- When stationary, alternate pings are skipped

### SQLite queue (offline-first — critical)
- Ping always written to SQLite BEFORE Supabase sync
- If online: syncs to Supabase after SQLite write
- If offline: stays in queue, no Supabase call
- Supabase failure: row stays in queue (not deleted)

### flushQueue
- Syncs all unsynced rows in timestamp ascending order
- Returns { synced: N, failed: M } counts
- Marks successfully synced rows in SQLite
- Continues on individual row failure

### Battery-mode logging (dev only)
- __DEV__ = true: console.log called with battery-mode: balanced
- __DEV__ = false: console.log not called

## Manual test procedure
Also create .claude/tests/manual/start-trip-battery.md:

# Manual: Start Trip Battery Test

## Setup
- Fully charged device (100%)
- Expo Go installed
- Record battery % at start

## Steps
1. Log in to Hadin
2. Note battery level
3. Start a trip (Lagos → Abuja, 2 contacts)
4. Lock screen
5. Wait 30 minutes
6. Note battery level — target: less than 5% drain
7. Unlock, verify ping appeared in Supabase dashboard
8. Turn on airplane mode
9. Wait for next ping interval
10. Turn off airplane mode
11. Verify ping synced to Supabase (flushQueue triggered)
12. Trigger SOS hold (3 seconds)
13. Verify SMS received on test number

## Pass criteria
- Less than 5% battery drain per 30 minutes
- Ping appears in Supabase within 2 minutes of interval
- Offline ping syncs within 60 seconds of connectivity restore
- SOS SMS received within 30 seconds of trigger
- No app crash during any step
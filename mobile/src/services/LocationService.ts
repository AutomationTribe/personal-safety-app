import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';
import * as Battery from 'expo-battery';
import { supabase } from '../lib/supabase';
import { checkIsOnline } from '../hooks/useNetworkStatus';
import { isRunning as isBatteryMonitorRunning } from './BatteryMonitor';

export type TrackingMode = 'continuous' | 'interval';

// Trip Mode battery gate: above RESUME it tracks continuously (live map);
// at/below THRESHOLD it drops to the same interval cadence as Always
// Online to save battery. The gap between the two is deliberate hysteresis
// (matches the pattern already used for Always Online's pause/resume in
// BatteryMonitor.ts) so it doesn't flap continuous/interval every time the
// level ticks across a single cutoff.
const TRIP_LOW_BATTERY_THRESHOLD = 0.20;
const TRIP_LOW_BATTERY_RESUME_THRESHOLD = 0.25;
export const TRIP_LOW_BATTERY_INTERVAL_MINUTES = 15;

export interface LocationPing {
  // null = Always Online ping, not tied to any trip.
  tripId: string | null;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: string;
  source: 'gps' | 'network' | 'passive';
  synced: boolean;
}

// ── Internal module state ────────────────────────────────────────────────────

let _db: SQLite.SQLiteDatabase | null = null;
let _trackingSubscription: Location.LocationSubscription | null = null;
let _intervalTimerId: ReturnType<typeof setInterval> | null = null;
let _mode: TrackingMode | null = null;
let _tripBatteryListener: Battery.Subscription | null = null;
let _tripBatteryDegraded = false;
let _activeTripId: string | null = null;
// Distinct from _activeTripId — Always Online tracking has no trip, but is
// still "tracking" (captureAndQueue must not bail out).
let _isTracking = false;
// Optional live-position observer (e.g. the dashboard map) — piggybacks on
// the single tracking watchPositionAsync subscription instead of running a
// second GPS watcher just for display.
let _positionListener: ((lat: number, lng: number) => void) | null = null;

// Stationary detection state
let _lastPingLat: number | null = null;
let _lastPingLng: number | null = null;
let _consecutiveStationaryCount = 0;
let _isStationary = false;
let _pingCount = 0;
let _skipNextPing = false;

// ── DB helpers ───────────────────────────────────────────────────────────────

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('hadin.db');
  await _db.execAsync(`
    CREATE TABLE IF NOT EXISTS location_pings_queue (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id   TEXT    NOT NULL,
      lat       REAL    NOT NULL,
      lng       REAL    NOT NULL,
      accuracy  REAL,
      speed     REAL,
      heading   REAL,
      timestamp TEXT    NOT NULL,
      source    TEXT    NOT NULL DEFAULT 'gps',
      synced    INTEGER NOT NULL DEFAULT 0
    );
  `);
  return _db;
}

async function insertPing(db: SQLite.SQLiteDatabase, ping: LocationPing): Promise<void> {
  // location_pings_queue.trip_id is TEXT NOT NULL — store '' for Always
  // Online pings (no trip) and translate back to null on read.
  await db.runAsync(
    `INSERT INTO location_pings_queue
       (trip_id, lat, lng, accuracy, speed, heading, timestamp, source, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [ping.tripId ?? '', ping.lat, ping.lng, ping.accuracy, ping.speed, ping.heading, ping.timestamp, ping.source],
  );
}

async function markSynced(db: SQLite.SQLiteDatabase, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  await db.runAsync(
    `UPDATE location_pings_queue SET synced = 1 WHERE id IN (${placeholders})`,
    ids,
  );
}

// ── Permission ───────────────────────────────────────────────────────────────

async function ensurePermission(): Promise<void> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission denied. Cannot track trip.');
  }
}

// ── Supabase sync (best-effort) ──────────────────────────────────────────────

async function syncPingToSupabase(ping: LocationPing): Promise<boolean> {
  try {
    const { error } = await supabase.from('location_pings').insert({
      trip_id: ping.tripId, // nullable — Always Online pings have no trip
      // PostGIS geography via WKT string
      coords: `POINT(${ping.lng} ${ping.lat})`,
      accuracy: ping.accuracy,
      speed: ping.speed,
      heading: ping.heading,
      source: ping.source,
      synced_at: new Date().toISOString(),
      created_at: ping.timestamp,
    });
    if (error) {
      console.warn('[LocationService] Supabase sync failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[LocationService] Supabase sync error:', err);
    return false;
  }
}

// ── Stationary detection ─────────────────────────────────────────────────────

export function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function updateStationaryState(lat: number, lng: number): void {
  if (_lastPingLat !== null && _lastPingLng !== null) {
    const dist = haversineMetres(_lastPingLat, _lastPingLng, lat, lng);
    if (dist < 100) {
      _consecutiveStationaryCount++;
      if (_consecutiveStationaryCount >= 2) _isStationary = true;
    } else {
      _consecutiveStationaryCount = 0;
      _isStationary = false;
    }
  }
  _lastPingLat = lat;
  _lastPingLng = lng;
}

export function getIsStationary(): boolean {
  return _isStationary;
}

// ── Accuracy gate ────────────────────────────────────────────────────────────
// Street-level accuracy requirement — readings worse than this (network/
// cell-tower/WiFi triangulation fixes typically read 100m-1km+) are
// discarded rather than shown on the map or written to location_pings.
export const ACCURACY_THRESHOLD_METRES = 50;

export function isAccurateEnough(accuracy: number | null): boolean {
  return accuracy != null && accuracy <= ACCURACY_THRESHOLD_METRES;
}

// ── Core logic ───────────────────────────────────────────────────────────────

async function captureAndQueue(
  accuracy: Location.Accuracy = Location.Accuracy.BestForNavigation,
): Promise<LocationPing | null> {
  if (!_isTracking) return null;

  // When stationary, skip alternate pings to double effective interval
  if (_isStationary) {
    _skipNextPing = !_skipNextPing;
    if (_skipNextPing) return null;
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy,
    // NOTE: `maximumAge` (reject cached readings older than 5s) was
    // requested but is not a valid expo-location `LocationOptions` field —
    // it's a browser Geolocation API concept this SDK doesn't expose. The
    // accuracy gate below (`isAccurateEnough`) is the actual defense
    // against stale/inaccurate readings being used.
    timeInterval: 3000,
  });

  // Reject low-accuracy (network/cell-tower) fixes outright — never write
  // or sync a reading that isn't street-level accurate.
  if (!isAccurateEnough(position.coords.accuracy)) {
    if (__DEV__) {
      console.log(
        `[LocationService] Discarded low-accuracy fix: ${position.coords.accuracy?.toFixed(0) ?? '?'}m (threshold ${ACCURACY_THRESHOLD_METRES}m)`,
      );
    }
    return null;
  }

  _pingCount++;

  const { latitude: lat, longitude: lng } = position.coords;
  updateStationaryState(lat, lng);
  _positionListener?.(lat, lng);

  if (__DEV__) {
    const countRow = await (await getDb()).getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM location_pings_queue WHERE synced = 0`,
    );
    console.log(
      `[LocationService] Ping #${_pingCount} | accuracy: ${position.coords.accuracy?.toFixed(0)}m | stationary: ${_isStationary} | queued: ${countRow?.n ?? 0} | mode: ${_mode ?? 'unknown'}`,
    );
  }

  const ping: LocationPing = {
    tripId: _activeTripId,
    lat,
    lng,
    accuracy: position.coords.accuracy,
    speed: position.coords.speed,
    heading: position.coords.heading,
    timestamp: new Date(position.timestamp).toISOString(),
    source: 'gps',
    synced: false,
  };

  const db = await getDb();
  // Always write to SQLite first
  await insertPing(db, ping);

  const online = await checkIsOnline();
  if (online) {
    const ok = await syncPingToSupabase(ping);
    if (ok) {
      // Mark the row we just inserted as synced
      const row = await db.getFirstAsync<{ id: number }>(
        `SELECT id FROM location_pings_queue
         WHERE trip_id = ? AND timestamp = ? ORDER BY id DESC LIMIT 1`,
        [ping.tripId, ping.timestamp],
      );
      if (row) await markSynced(db, [row.id]);
    }
  }

  return ping;
}

// ── Continuous vs interval mechanics ─────────────────────────────────────────

async function startContinuousWatch(): Promise<void> {
  // High-accuracy GPS mode — street-level fixes only, fixed 5s/10m trigger
  // (live map cadence, not the caller-supplied interval — this path is only
  // used for Trip Mode, which wants a live map, not periodic checks).
  _trackingSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 5000,
      distanceInterval: 10,
    },
    async (pos) => {
      if (isAccurateEnough(pos.coords.accuracy)) {
        _positionListener?.(pos.coords.latitude, pos.coords.longitude);
      }
      await captureAndQueue(Location.Accuracy.BestForNavigation);
    },
  );
}

function stopContinuousWatch(): void {
  _trackingSubscription?.remove();
  _trackingSubscription = null;
}

function startIntervalPolling(minutes: number): void {
  stopIntervalPolling();
  // Battery-first rule: Balanced accuracy (not BestForNavigation) for
  // interval pings, and getCurrentPositionAsync (not a continuous watch)
  // so the GPS lock is acquired and released each time rather than held.
  _intervalTimerId = setInterval(() => {
    void captureAndQueue(Location.Accuracy.Balanced);
  }, minutes * 60_000);
}

function stopIntervalPolling(): void {
  if (_intervalTimerId) clearInterval(_intervalTimerId);
  _intervalTimerId = null;
}

async function switchTrackingMode(mode: TrackingMode): Promise<void> {
  if (_mode === mode) return;
  _mode = mode;
  if (mode === 'continuous') {
    stopIntervalPolling();
    await startContinuousWatch();
  } else {
    stopContinuousWatch();
    startIntervalPolling(TRIP_LOW_BATTERY_INTERVAL_MINUTES);
  }
}

/**
 * Trip Mode only — degrades a continuous session to the same interval
 * cadence as Always Online once battery is low, and restores continuous
 * tracking once it recovers. Best-effort: any expo-battery failure just
 * leaves tracking in whatever mode it already started in.
 */
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

function stopTripBatteryGate(): void {
  _tripBatteryListener?.remove();
  _tripBatteryListener = null;
  _tripBatteryDegraded = false;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start writing pings on a battery-optimized cadence.
 * Pass a tripId for Trip Mode, or null for Always Online (pings are still
 * written — with trip_id = null — so Always Online works with no active trip).
 *
 * `mode` picks the tracking mechanism:
 * - 'continuous' (default, Trip Mode): live 5s/10m GPS watch for the active
 *   map, automatically degraded to 'interval' if the battery gets low (see
 *   `startTripBatteryGate`).
 * - 'interval': periodic `intervalMinutes`-spaced checks (GPS lock acquired
 *   and released each time, not held) — used for Always Online, and for
 *   Trip Mode once battery is low.
 */
export async function startTracking(
  tripId: string | null,
  intervalMinutes: number,
  mode: TrackingMode = 'continuous',
): Promise<void> {
  // NOTE: True background location requires a dev build (not Expo Go)
  // expo-task-manager + expo-background-fetch handles the 30-min
  // heartbeat. Foreground tracking works in Expo Go.
  // Switch to dev build (eas build --profile development) for
  // full background support in Phase 6.
  if (_isTracking) {
    console.warn('[LocationService] Already tracking. Call stopTracking() first.');
    return;
  }

  await ensurePermission();
  _activeTripId = tripId;
  _isTracking = true;
  _mode = mode;
  _pingCount = 0;
  _lastPingLat = null;
  _lastPingLng = null;
  _consecutiveStationaryCount = 0;
  _isStationary = false;
  _skipNextPing = false;

  // Capture immediately on start
  await captureAndQueue(mode === 'continuous' ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced);

  if (mode === 'continuous') {
    await startContinuousWatch();
    // Only Trip Mode starts continuous — Always Online always starts in
    // 'interval' mode, so this gate only ever applies to trips.
    await startTripBatteryGate();
  } else {
    startIntervalPolling(intervalMinutes);
  }
}

/**
 * Subscribe to raw position updates from the single tracking watcher
 * (e.g. to live-update a map) without spinning up a second GPS watcher.
 * Pass null to unsubscribe.
 */
export function setPositionListener(listener: ((lat: number, lng: number) => void) | null): void {
  _positionListener = listener;
}

export async function stopTracking(): Promise<void> {
  stopContinuousWatch();
  stopIntervalPolling();
  stopTripBatteryGate();
  _mode = null;
  _activeTripId = null;
  _isTracking = false;
  _positionListener = null;
  _lastPingLat = null;
  _lastPingLng = null;
  _consecutiveStationaryCount = 0;
  _isStationary = false;
  _skipNextPing = false;
}

export function isTracking(): boolean {
  return _isTracking;
}

export function getActiveTripId(): string | null {
  return _activeTripId;
}

/**
 * Attach a trip to an already-running Always Online session (general.md:
 * "user can set a trip when in always on mode") — reuses the existing
 * watcher rather than stopping/restarting it, so subsequent pings are
 * tagged with this trip instead of trip_id = null.
 */
export function attachTrip(tripId: string): void {
  _activeTripId = tripId;
}

/**
 * Detach the trip from a still-running Always Online session when a trip
 * ends but the user is still in Always Online mode — reverts subsequent
 * pings to trip_id = null instead of stopping tracking outright.
 */
export function detachTrip(): void {
  _activeTripId = null;
}

export async function getCurrentLocation(): Promise<LocationPing> {
  await ensurePermission();

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.BestForNavigation,
    // NOTE: `maximumAge` (reject cached readings older than 5s) was
    // requested but is not a valid expo-location `LocationOptions` field —
    // it's a browser Geolocation API concept this SDK doesn't expose. The
    // accuracy gate below (`isAccurateEnough`) is the actual defense
    // against stale/inaccurate readings being used.
    timeInterval: 3000,
  });

  return {
    tripId: _activeTripId,
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    speed: position.coords.speed,
    heading: position.coords.heading,
    timestamp: new Date(position.timestamp).toISOString(),
    source: 'gps',
    synced: false,
  };
}

/**
 * Wait for a street-level-accurate GPS fix (accuracy <= ACCURACY_THRESHOLD_METRES)
 * instead of returning whatever the first (possibly network-triangulated)
 * reading happens to be. Used to centre a map only once a precise fix is
 * available. Resolves early with the best fix seen if `timeoutMs` elapses
 * without reaching the threshold; resolves `null` if no fix arrives at all.
 */
export async function getAccurateFix(timeoutMs = 20_000): Promise<Location.LocationObject | null> {
  await ensurePermission();

  return new Promise((resolve) => {
    let settled = false;
    let best: Location.LocationObject | null = null;
    let sub: Location.LocationSubscription | undefined;

    const finish = (result: Location.LocationObject | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub?.remove();
      resolve(result);
    };

    const timer = setTimeout(() => finish(best), timeoutMs);

    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 3000, distanceInterval: 5 },
      (pos) => {
        if (best === null || (pos.coords.accuracy ?? Infinity) < (best.coords.accuracy ?? Infinity)) {
          best = pos;
        }
        if (isAccurateEnough(pos.coords.accuracy)) {
          finish(pos);
        }
      },
    )
      .then((s) => {
        sub = s;
        if (settled) sub.remove();
      })
      .catch(() => finish(null));
  });
}

export async function getQueuedPings(): Promise<LocationPing[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    trip_id: string;
    lat: number;
    lng: number;
    accuracy: number | null;
    speed: number | null;
    heading: number | null;
    timestamp: string;
    source: string;
    synced: number;
  }>(`SELECT * FROM location_pings_queue WHERE synced = 0 ORDER BY timestamp ASC`);

  return rows.map((r) => ({
    tripId: r.trip_id.length > 0 ? r.trip_id : null,
    lat: r.lat,
    lng: r.lng,
    accuracy: r.accuracy,
    speed: r.speed,
    heading: r.heading,
    timestamp: r.timestamp,
    source: r.source as LocationPing['source'],
    synced: r.synced === 1,
  }));
}

export async function getLastPing(): Promise<LocationPing | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    trip_id: string;
    lat: number;
    lng: number;
    accuracy: number | null;
    speed: number | null;
    heading: number | null;
    timestamp: string;
    source: string;
    synced: number;
  }>(`SELECT * FROM location_pings_queue ORDER BY timestamp DESC LIMIT 1`);

  if (!row) return null;
  return {
    tripId: row.trip_id.length > 0 ? row.trip_id : null,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    speed: row.speed,
    heading: row.heading,
    timestamp: row.timestamp,
    source: row.source as LocationPing['source'],
    synced: row.synced === 1,
  };
}

export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    trip_id: string;
    lat: number;
    lng: number;
    accuracy: number | null;
    speed: number | null;
    heading: number | null;
    timestamp: string;
    source: string;
  }>(`SELECT * FROM location_pings_queue WHERE synced = 0 ORDER BY timestamp ASC`);

  if (rows.length === 0) return { synced: 0, failed: 0 };

  // Build the payload for a single bulk insert
  const payload = rows.map((row) => ({
    trip_id: row.trip_id.length > 0 ? row.trip_id : null,
    coords: `POINT(${row.lng} ${row.lat})`,
    accuracy: row.accuracy,
    speed: row.speed,
    heading: row.heading,
    source: row.source,
    synced_at: new Date().toISOString(),
    created_at: row.timestamp,
  }));

  try {
    const { error } = await supabase.from('location_pings').insert(payload);

    if (!error) {
      // All rows inserted — mark them all synced in one UPDATE
      await markSynced(db, rows.map((r) => r.id));
      return { synced: rows.length, failed: 0 };
    }

    console.warn('[LocationService] Bulk flush failed, falling back to per-row sync:', error.message);
  } catch (err) {
    console.warn('[LocationService] Bulk flush error, falling back to per-row sync:', err);
  }

  // Fallback: per-row sync (original behaviour) — handles partial failures
  // gracefully (e.g. one malformed row doesn't block the rest).
  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    const ping: LocationPing = {
      tripId: row.trip_id.length > 0 ? row.trip_id : null,
      lat: row.lat,
      lng: row.lng,
      accuracy: row.accuracy,
      speed: row.speed,
      heading: row.heading,
      timestamp: row.timestamp,
      source: row.source as LocationPing['source'],
      synced: false,
    };

    const ok = await syncPingToSupabase(ping);
    if (ok) {
      await markSynced(db, [row.id]);
      synced++;
    } else {
      failed++;
    }
  }

  return { synced, failed };
}

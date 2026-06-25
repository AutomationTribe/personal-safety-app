import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';
import { supabase } from '../lib/supabase';
import { checkIsOnline } from '../hooks/useNetworkStatus';

export interface LocationPing {
  tripId: string;
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
let _activeTripId: string | null = null;

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
  await db.runAsync(
    `INSERT INTO location_pings_queue
       (trip_id, lat, lng, accuracy, speed, heading, timestamp, source, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [ping.tripId, ping.lat, ping.lng, ping.accuracy, ping.speed, ping.heading, ping.timestamp, ping.source],
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
      trip_id: ping.tripId,
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

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

// ── Core logic ───────────────────────────────────────────────────────────────

async function captureAndQueue(): Promise<void> {
  if (!_activeTripId) return;

  // When stationary, skip alternate pings to double effective interval
  if (_isStationary) {
    _skipNextPing = !_skipNextPing;
    if (_skipNextPing) return;
  }

  _pingCount++;

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const { latitude: lat, longitude: lng } = position.coords;
  updateStationaryState(lat, lng);

  const queued = await (await getDb()).getAllAsync<{ id: number }>(
    `SELECT id FROM location_pings_queue WHERE synced = 0`,
  );

  if (__DEV__) {
    console.log(
      `[LocationService] Ping #${_pingCount} | accuracy: ${position.coords.accuracy?.toFixed(0)}m | stationary: ${_isStationary} | queued: ${queued.length} | battery-mode: balanced`,
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
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function startTracking(tripId: string, intervalMinutes: number): Promise<void> {
  // NOTE: True background location requires a dev build (not Expo Go)
  // expo-task-manager + expo-background-fetch handles the 30-min
  // heartbeat. Foreground tracking works in Expo Go.
  // Switch to dev build (eas build --profile development) for
  // full background support in Phase 6.
  if (_trackingSubscription) {
    console.warn('[LocationService] Already tracking. Call stopTracking() first.');
    return;
  }

  await ensurePermission();
  _activeTripId = tripId;
  _pingCount = 0;
  _lastPingLat = null;
  _lastPingLng = null;
  _consecutiveStationaryCount = 0;
  _isStationary = false;
  _skipNextPing = false;

  // Capture immediately on start
  await captureAndQueue();

  // Use watchPositionAsync with combined time + distance trigger.
  // distanceInterval: 500 prevents pings when the traveller is stationary
  // (stopped at a checkpoint, sleeping in the bus).
  // Accuracy.Balanced uses cell tower + WiFi triangulation — far less
  // battery drain than pure GPS (Accuracy.High).
  _trackingSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: intervalMinutes * 60 * 1000,
      distanceInterval: 500,
    },
    async () => {
      await captureAndQueue();
    },
  );
}

export async function stopTracking(): Promise<void> {
  if (_trackingSubscription) {
    _trackingSubscription.remove();
    _trackingSubscription = null;
  }
  _activeTripId = null;
  _lastPingLat = null;
  _lastPingLng = null;
  _consecutiveStationaryCount = 0;
  _isStationary = false;
  _skipNextPing = false;
}

export async function getCurrentLocation(): Promise<LocationPing> {
  await ensurePermission();

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });

  return {
    tripId: _activeTripId ?? '',
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
    tripId: r.trip_id,
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
    tripId: row.trip_id,
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

  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    const ping: LocationPing = {
      tripId: row.trip_id,
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

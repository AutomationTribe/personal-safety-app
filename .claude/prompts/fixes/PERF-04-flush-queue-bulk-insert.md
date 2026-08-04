# PERF-04 — `flushQueue()` syncs location pings sequentially one HTTP request per ping

## What to fix

`mobile/src/services/LocationService.ts`, lines 578–618.

`flushQueue()` reads all unsynced rows from SQLite and then loops over them one by one, calling `syncPingToSupabase(ping)` (which calls `supabase.from('location_pings').insert(...)`) for each row individually. On a long offline period (e.g. 2-hour drive with 30-minute intervals = 4 pings, or continuous mode = ~144 pings over 12 hours), this creates N sequential Supabase round-trips on reconnect, each with its own TCP + TLS handshake overhead on a mobile connection.

**Current implementation (lines 594–615):**

```ts
for (const row of rows) {
  const ping: LocationPing = { ... };
  const ok = await syncPingToSupabase(ping);
  if (ok) {
    await markSynced(db, [row.id]);
    synced++;
  } else {
    failed++;
  }
}
```

## Why it matters

In Nigeria, mobile connections frequently drop and reconnect. After a reconnect, the flush runs N sequential inserts. Each one carries a full TLS handshake (300–800 ms on a 3G connection), so 20 queued pings = 6–16 seconds of network time for the flush. During that window the location data is not yet in Supabase, the dashboard shows a stale track, and the flush itself competes with any live-ping or SOS traffic.

Supabase supports bulk inserts: `supabase.from('location_pings').insert([...rows])` — a single request inserts all rows atomically.

## Exact fix

Replace the sequential for-loop with a single bulk insert. On success, mark all rows synced at once. On failure, fall back to the existing per-row logic so a partial Supabase error doesn't silently drop all pings.

**Full replacement for `flushQueue()` (lines 578–618):**

```ts
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
```

## Files to touch

- `mobile/src/services/LocationService.ts` — replace the body of `flushQueue()` (lines 578–618)

## Test steps

1. Disable the device's data connection (airplane mode).
2. Start a trip in interval mode. Let it accumulate 4–6 pings (wait 2–3 minutes in a dev build where the interval is shortened, or mock the interval timer).
3. Re-enable data. Trigger `flushQueue()` (it is called implicitly when connectivity returns via the `useNetworkStatus` hook in the app, or call it directly from a test).
4. In Metro logs, confirm a single `[LocationService]` sync log line (not N lines).
5. In the Supabase dashboard (Table Editor → location_pings), confirm all N pings appear with correct timestamps.
6. In the local SQLite DB (via Expo SQLite debug output), confirm all rows are marked `synced = 1`.
7. To test the fallback path: temporarily mock `supabase.from('location_pings').insert` to return an error on the first call, then return success on subsequent calls — confirm the per-row fallback fires and all rows are eventually synced.

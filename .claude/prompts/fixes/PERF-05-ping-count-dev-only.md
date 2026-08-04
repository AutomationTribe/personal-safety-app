# PERF-05 — Full SQLite table scan runs on every GPS ping for a dev-only log

## What to fix

`mobile/src/services/LocationService.ts`, lines 215–220.

Inside `captureAndQueue()`, which runs every 5 seconds in continuous mode, there is a query that fetches all unsynced row IDs from the SQLite queue:

```ts
const queued = await (await getDb()).getAllAsync<{ id: number }>(
  `SELECT id FROM location_pings_queue WHERE synced = 0`,
);

if (__DEV__) {
  console.log(
    `[LocationService] Ping #${_pingCount} | accuracy: ${position.coords.accuracy?.toFixed(0)}m | stationary: ${_isStationary} | queued: ${queued.length} | mode: ${_mode ?? 'unknown'}`,
  );
}
```

Two problems:
1. The `getAllAsync` call runs unconditionally — in production (`__DEV__ === false`) the result is fetched and immediately discarded. The query is a full table scan fetching every row's `id` from `location_pings_queue` solely to compute a count.
2. Even in dev, `getAllAsync` fetches entire rows, not just a scalar count. A `COUNT(*)` is a single-pass aggregation the SQLite engine runs without materialising rows into JS.

On a long trip with many queued pings (e.g. 100+ pings after a long offline stretch), this is 100+ row objects allocated, deserialised, and GC'd every 5 seconds — entirely for a dev log.

## Why it matters

`captureAndQueue` is the hot path — it runs every 5 seconds during Trip Mode continuous tracking. An unnecessary full table scan on every GPS ping wastes both CPU and battery. This is explicitly flagged in CLAUDE.md as a battery-sensitive file.

## Exact fix

Gate the entire block behind `__DEV__` and replace `getAllAsync` with `getFirstAsync` + a `COUNT(*)` query so no rows are materialised.

**Before (lines 215–222):**

```ts
const queued = await (await getDb()).getAllAsync<{ id: number }>(
  `SELECT id FROM location_pings_queue WHERE synced = 0`,
);

if (__DEV__) {
  console.log(
    `[LocationService] Ping #${_pingCount} | accuracy: ${position.coords.accuracy?.toFixed(0)}m | stationary: ${_isStationary} | queued: ${queued.length} | mode: ${_mode ?? 'unknown'}`,
  );
}
```

**After:**

```ts
if (__DEV__) {
  const countRow = await (await getDb()).getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM location_pings_queue WHERE synced = 0`,
  );
  console.log(
    `[LocationService] Ping #${_pingCount} | accuracy: ${position.coords.accuracy?.toFixed(0)}m | stationary: ${_isStationary} | queued: ${countRow?.n ?? 0} | mode: ${_mode ?? 'unknown'}`,
  );
}
```

Changes:
- The query only runs when `__DEV__` is true — zero overhead in production builds.
- `getFirstAsync` returns a single row containing the count; no array of id objects is allocated.
- `COUNT(*)` is evaluated by SQLite as a single pass without materialising rows.

## Files to touch

- `mobile/src/services/LocationService.ts` — lines 215–222, replace the `getAllAsync` + conditional log block

## Test steps

1. In a dev build (`__DEV__ === true`), start a trip and let it run for a few pings. Confirm the Metro log still shows `queued: N` on each ping.
2. Build a production bundle (`npx expo export` or `eas build --profile production`) and confirm via a source map that the `COUNT(*)` block is absent in the output — Babel/Metro strips `__DEV__` false branches.
3. Confirm no TypeScript errors (the `countRow` type is `{ n: number } | null` from `getFirstAsync`, handled by `countRow?.n ?? 0`).

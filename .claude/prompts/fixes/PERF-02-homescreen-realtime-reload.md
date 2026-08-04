# PERF-02 — HomeScreen fires 6 Supabase queries on every realtime event

## What to fix

`mobile/src/screens/trip/HomeScreen.tsx`, lines 280–287.

The realtime channel subscribed to the `trips` table uses `event: '*'` — it fires on INSERT, UPDATE, and DELETE. On every event, it calls the full `loadData()` function which runs 6+ parallel Supabase queries (active trip, recent trips, contacts x2, profile, active SOS event, plus a conditional family groups fetch).

```ts
// Current — fires loadData() for every postgres event including INSERTs from other users
const channel = supabase
  .channel(`home-trips-${Date.now()}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => { loadData(); })
  .subscribe();
```

Trip INSERTs happen frequently (new trips created from any session). `event: '*'` means a team of 5 contacts each starting a trip fires 5 full `loadData()` refreshes on this user's device — none of which are relevant to them.

## Why it matters

Each `loadData()` call issues 6–7 Supabase queries. On a slow mobile connection (common in Nigeria), these compete with the location-ping sync path and inflate data usage. The realtime listener is the trigger — limiting it to `UPDATE` events (status changes only — the events that actually matter for the active trip display) removes the INSERT-driven noise entirely.

## Exact fix

Change the realtime channel subscription from `event: '*'` to `event: 'UPDATE'`.

**Before (lines 280–287):**

```ts
useEffect(() => {
  const channel = supabase
    .channel(`home-trips-${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => { loadData(); })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [loadData]);
```

**After:**

```ts
useEffect(() => {
  const channel = supabase
    .channel(`home-trips-${Date.now()}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trips' }, () => { loadData(); })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [loadData]);
```

That is the only change required. The `loadData()` call itself remains unchanged — the full reload is appropriate for an UPDATE (e.g. trip status changed to `completed`) since multiple fields in the UI depend on trip state.

> If a future pass wants to narrow further, the `new` payload from the realtime event can be used to selectively update only `activeTrip` / `recentTrips` without a full reload. That optimisation is out of scope for this fix.

## Files to touch

- `mobile/src/screens/trip/HomeScreen.tsx` — line 284, change `event: '*'` to `event: 'UPDATE'`

## Test steps

1. Open two devices / simulators logged in as the same user.
2. On device A, start a new trip. On device B, confirm the HomeScreen does NOT refresh (no loadData spinner or state reset) — the INSERT is now ignored.
3. On device A, end the trip (status UPDATE to `completed`). On device B, confirm the HomeScreen does refresh and shows the trip moved to history.
4. In Metro logs on device B, confirm `loadData` is not logged on a new-trip INSERT from device A.

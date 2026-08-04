# PERF-07 — Redundant contact fetch during SOS SMS fallback

## What to fix

`mobile/src/services/SOSService.ts`, lines 291–297 (the SMS fallback contact resolution block inside `triggerSOS`).

When the internet path fails and the SMS fallback fires, `triggerSOS` reads the AsyncStorage contacts cache, and if it is empty, makes a Supabase round-trip to `getSOSContacts()`:

```ts
// 4. SMS fallback — use cache, try a fresh fetch if cache is empty
let fallbackContacts = await readContactCache();
if (fallbackContacts.length === 0) {
  try {
    fallbackContacts = await getSOSContacts(tripId);
  } catch {
    // getSOSContacts already handles errors gracefully
  }
}
```

`HomeScreen.tsx` already has the full list of trusted contacts loaded in the `tripContacts` state (populated by `loadData()` at line 199 — it fetches `trusted_contacts` for the current trip). This data is already in memory at the moment `triggerSOS` is called. Re-fetching it from Supabase during an emergency — when the internet path has already failed — is:

1. Likely to fail (we're in a partial-connectivity scenario)
2. Unnecessary — the data is already in the caller's hands
3. A source of additional latency before the SMS composer opens

## Why it matters

SOS is the safety-critical path. Every millisecond of delay before the SMS composer opens is a risk. When the internet path fails, the fallback path should be instant. A Supabase fetch during a connectivity failure can hang for seconds before timing out, delaying the SMS composer.

## Exact fix

### Step 1 — Add `fallbackPhones` parameter to `triggerSOS`

**`mobile/src/services/SOSService.ts` — update the `triggerSOS` signature:**

```ts
// Before
export async function triggerSOS(
  tripId: string | null,
  contactIds: string[],
): Promise<SOSResult> {

// After
export async function triggerSOS(
  tripId: string | null,
  contactIds: string[],
  fallbackPhones?: string[],
): Promise<SOSResult> {
```

### Step 2 — Use `fallbackPhones` when provided, skip the Supabase fetch

**`mobile/src/services/SOSService.ts` — replace lines 291–297:**

```ts
// Before
// 4. SMS fallback — use cache, try a fresh fetch if cache is empty
let fallbackContacts = await readContactCache();
if (fallbackContacts.length === 0) {
  try {
    fallbackContacts = await getSOSContacts(tripId);
  } catch {
    // getSOSContacts already handles errors gracefully
  }
}

const phones = fallbackContacts.map((c) => c.phone);
await openSMSFallback(phones, lat, lng);
```

```ts
// After
// 4. SMS fallback — prefer phones passed by the caller (already in memory),
// fall back to cache, then try a fresh fetch only as last resort.
let phones: string[];
if (fallbackPhones && fallbackPhones.length > 0) {
  phones = fallbackPhones;
} else {
  let fallbackContacts = await readContactCache();
  if (fallbackContacts.length === 0) {
    try {
      fallbackContacts = await getSOSContacts(tripId);
    } catch {
      // getSOSContacts already handles errors gracefully
    }
  }
  phones = fallbackContacts.map((c) => c.phone);
}

await openSMSFallback(phones, lat, lng);
```

### Step 3 — Pass `tripContacts` phones from `HomeScreen.tsx`

In `mobile/src/screens/trip/HomeScreen.tsx`, `handleSOSTap` calls `triggerSOS`. Pass the phone numbers from `tripContacts` state:

**Before (line 618):**

```ts
const result = await triggerSOS(activeTrip?.id ?? null, activeTrip?.contact_ids ?? []);
```

**After:**

```ts
const result = await triggerSOS(
  activeTrip?.id ?? null,
  activeTrip?.contact_ids ?? [],
  tripContacts.map((c) => c.phone),
);
```

The `tripContacts` state is already populated at this point (loaded by `loadData()` on mount and after any trip update). The phones are available immediately — no async wait.

> `triggerSOS` is also called from `handleSOSCountdownConfirm` which calls `handleSOSTap` — no additional change needed there.

## Files to touch

- `mobile/src/services/SOSService.ts` — update `triggerSOS` signature, update contact resolution block (lines 291–300)
- `mobile/src/screens/trip/HomeScreen.tsx` — update `triggerSOS` call in `handleSOSTap` (line 618)

## Test steps

1. Start a trip with at least one trusted contact who has a phone number set.
2. Force the device offline (airplane mode).
3. Tap SOS. Time from tap to SMS composer opening — should be under 2 seconds (GPS + no Supabase round-trip).
4. In Metro logs, confirm `[SOS] SMS fallback opened | phones=N` appears and N matches the number of contacts in `tripContacts`, not 0.
5. Confirm `getSOSContacts` is NOT called during the offline SOS flow (add a temporary `console.log` inside `getSOSContacts` and confirm it does not appear in the log).
6. Test with empty `tripContacts` (no contacts added) — confirm it falls back to the cache path gracefully.

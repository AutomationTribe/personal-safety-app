# SEC-13 — No fetch timeout on SOS internet path — SMS fallback delayed in emergencies

## What to fix

`mobile/src/services/SOSService.ts`, lines 255–279 (the internet path inside `triggerSOS`). The `fetch` call to `${BACKEND_URL}/api/v1/sos` has no timeout. On a captive portal, a degraded 2G/EDGE connection, or a congested network, `checkIsOnline()` can return `true` (because `isInternetReachable` is not always updated before the fetch fires) but the HTTP request hangs for the OS default TCP timeout — up to 30 seconds on iOS, 75 seconds on Android.

During those 30 s the SMS fallback does not fire. In a genuine emergency, 30 s of silence before the circle is notified is unacceptable.

**Affected location:**
`mobile/src/services/SOSService.ts` lines 257–265 (the `fetch` call and its `response.ok` check).

## Why it matters

SOS is the safety-critical path. If the internet path stalls and the SMS fallback is delayed by 30+ seconds, the user's circle is not notified in time. The fix bounds the internet path to 4 500 ms so the SMS fallback fires quickly on degraded connections.

The 4 500 ms budget was chosen because:
- It is short enough to feel instant on a good connection (~200–500 ms round-trip)
- It gives the backend enough headroom to process (POST, insert, fire AT SMS, respond) on a slow but real connection
- It is far shorter than the OS default TCP timeout

## Exact fix

Wrap the existing `fetch` call in an `AbortController` with a 4 500 ms timeout.

**Before (lines 255–279 of `SOSService.ts`):**

```ts
if (online && token) {
  const { batteryLevel, networkType } = await getDeviceSnapshot();
  const response = await fetch(`${BACKEND_URL}/api/v1/sos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tripId, lat, lng, timestamp: new Date().toISOString(), batteryLevel, networkType }),
  });

  if (response.ok) {
    const body = (await response.json()) as {
      success: boolean;
      eventId?: string;
      notified: number;
      total: number;
    };
    console.log(`[SOS] Backend OK | eventId=${body.eventId} notified=${body.notified}/${body.total}`);
    return { success: true, eventId: body.eventId, notified: body.notified, total: body.total };
  }

  // 429 rate limit or other non-OK → SMS fallback
  console.warn(`[SOS] Backend returned ${response.status} — SMS fallback`);
}
```

**After:**

```ts
if (online && token) {
  const { batteryLevel, networkType } = await getDeviceSnapshot();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/sos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tripId, lat, lng, timestamp: new Date().toISOString(), batteryLevel, networkType }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const body = (await response.json()) as {
        success: boolean;
        eventId?: string;
        notified: number;
        total: number;
      };
      console.log(`[SOS] Backend OK | eventId=${body.eventId} notified=${body.notified}/${body.total}`);
      return { success: true, eventId: body.eventId, notified: body.notified, total: body.total };
    }

    // 429 rate limit or other non-OK → SMS fallback
    console.warn(`[SOS] Backend returned ${response.status} — SMS fallback`);
  } catch (fetchErr) {
    clearTimeout(timeoutId);
    // AbortError means the 4 500 ms timeout fired — fall through to SMS fallback
    const isTimeout = fetchErr instanceof Error && fetchErr.name === 'AbortError';
    console.warn(`[SOS] Backend ${isTimeout ? 'timed out after 4500ms' : 'unreachable'} — SMS fallback`);
    // Re-throw so the outer catch block handles it and falls through to SMS fallback
    throw fetchErr;
  }
}
```

> **Important:** the inner `try/catch` re-throws so the existing outer `catch` block (lines 280–282) still catches it and falls through naturally to the SMS fallback at line 291. The structure of the outer try/catch and the SMS fallback below it does not change.

## Files to touch

- `mobile/src/services/SOSService.ts` — the internet path inside `triggerSOS` (lines 255–279)

## Test steps

1. Start the app with an active trip.
2. Simulate a stalled network: in a dev build, you can insert `await new Promise(r => setTimeout(r, 10000))` temporarily before the `fetch` in a local backend route handler, or use Charles Proxy / Network Link Conditioner to throttle the connection to "Very Bad Network".
3. Tap SOS. Confirm that:
   - The SMS composer opens within ~5 seconds (not 30+)
   - Metro logs show `[SOS] Backend timed out after 4500ms — SMS fallback`
4. On a good connection, confirm SOS still reaches the backend successfully (no false timeout on a normal connection).
5. Remove any temporary test code.

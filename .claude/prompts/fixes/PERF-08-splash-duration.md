# PERF-08 — Splash screen shows for 7 full seconds unconditionally

## What to fix

`mobile/src/navigation/AppNavigator.tsx`, line 135.

```ts
const MIN_SPLASH_MS = 7000;
```

This constant controls the minimum time the branded splash screen is shown before the app navigates to the auth or home screen. The `AppNavigator` waits for **both** `authReady` (Supabase session resolved) **and** `minSplashElapsed` before rendering. Since auth typically resolves in 500–1500 ms on a good connection, the app is fully ready but blocked waiting for the remaining 5–6 seconds of splash.

```ts
if (!authReady || !minSplashElapsed) {
  return <AppSplashScreen />;
}
```

## Why it matters

For a safety app, time-to-interactive is a trust signal. A user in an emergency who reopens the app faces a 7-second wait before they can tap SOS. Even for routine use, a 7-second cold start is far beyond the 2–3 seconds users expect from a native app. The branded splash serves brand recognition — it does not need 7 seconds to achieve that.

2 500 ms is enough time to:
- Display the logo and name clearly
- Complete the Supabase session check (typically < 1 500 ms)
- Animate the splash out gracefully

## Exact fix

**`mobile/src/navigation/AppNavigator.tsx`, line 135:**

```ts
// Before
const MIN_SPLASH_MS = 7000;

// After
const MIN_SPLASH_MS = 2500;
```

That is the only change required. No logic changes, no structural changes.

## Files to touch

- `mobile/src/navigation/AppNavigator.tsx` — line 135, change `7000` to `2500`

## Test steps

1. Cold-launch the app (kill it fully, relaunch).
2. Time the duration from the app becoming visible to the home/auth screen appearing. Confirm it is approximately 2.5 seconds (or less if auth resolves before 2.5 s).
3. Confirm the splash animation completes cleanly — no abrupt cut.
4. Confirm auth still resolves correctly — the home screen (or subscription gate / phone capture screen) appears as before after the splash.
5. Test on a slow network (throttle to 3G via Charles Proxy or Network Link Conditioner) — confirm the app waits at most 2.5 s even if auth is slow, then shows the fallback (catch block returns `'Home'`), which is the existing behaviour unchanged.

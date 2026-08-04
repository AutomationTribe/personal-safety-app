# SEC-06 — Remove Africa's Talking API key prefix from production logs

## What to fix

**File:** `backend/src/services/africastalking.ts` (lines 17–18)

```ts
console.log('[AT] Username:', username);
console.log('[AT] Key prefix:', apiKey.slice(0, 10));
```

These two lines fire on every SMS send (every SOS alert, every contact notification, every trip-start notification). In production, Railway aggregates all stdout into a log stream that may be accessible to multiple team members, third-party log services, or security auditors. Exposing even the first 10 characters of an API key narrows a brute-force attack and may violate Africa's Talking's key confidentiality requirements.

## Why it matters

Partial API key exposure in logs is a recognized credential leak pattern. Combined with the username (also logged), an attacker who gains read access to logs has meaningful assistance in rotating or abusing the key. The `[AT] Sending SMS to` line already gives sufficient operational visibility.

## Exact fix

**`backend/src/services/africastalking.ts` — before (lines 16–18):**
```ts
console.log('[AT] Sending SMS to', to.slice(0, 8) + '****');
console.log('[AT] Username:', username);
console.log('[AT] Key prefix:', apiKey.slice(0, 10));
```

**After:**
```ts
if (process.env.NODE_ENV !== 'production') {
  console.log('[AT] Username:', username);
  console.log('[AT] Key prefix:', apiKey.slice(0, 10));
}
console.log('[AT] Sending SMS to', to.slice(0, 8) + '****');
```

This keeps the debug information available in development while removing it from production logs. The phone number partial log is not a credential and is useful for operational tracing, so it remains unconditional.

If the team prefers a simpler removal, delete lines 17–18 entirely — no condition needed.

## Files to touch

- `backend/src/services/africastalking.ts`

## Test steps

1. Set `NODE_ENV=production` in `.env`, restart the server, trigger an SMS send (e.g. call the contacts notify endpoint) — confirm the Railway/server logs contain `[AT] Sending SMS to` but NOT `[AT] Username:` or `[AT] Key prefix:`.
2. Set `NODE_ENV=development`, trigger an SMS send — confirm both debug lines appear in local console output.
3. `cd backend && npx tsc --noEmit` — no type errors.

# SEC-10 — Fix gendered pronoun and typo in SOS SMS message

## What to fix

**File:** `backend/src/routes/sos.ts` (line 266)

```ts
const baseMessage = `SOS alert from ${userName}. His last know location is ${lat}, ${lng} (${mapsUrl}) - Hadin (https://hadin.app)`;
```

Two problems:
1. **Wrong gender assumption:** "His" assumes the traveller is male. The system has no gender field — this is incorrect for all non-male users.
2. **Typo:** "know" should be "known".

## Why it matters

SOS messages are sent to trusted contacts during emergencies. Incorrect grammar and a gendered pronoun that doesn't match the user are unprofessional and potentially confusing in a high-stress situation. The "known" typo is particularly noticeable in a safety-critical message.

## Exact fix

**`backend/src/routes/sos.ts` line 266 — before:**
```ts
const baseMessage = `SOS alert from ${userName}. His last know location is ${lat}, ${lng} (${mapsUrl}) - Hadin (https://hadin.app)`;
```

**After:**
```ts
const baseMessage = `SOS alert from ${userName}. Their last known location is ${lat}, ${lng} (${mapsUrl}) - Hadin (https://hadin.app)`;
```

## Files to touch

- `backend/src/routes/sos.ts`

## Test steps

1. Trigger a test SOS (call `POST /api/v1/sos` with a valid token and test coordinates) — inspect the SMS body in the AT sandbox or server log line `[SOS] SMS sent →` to confirm the message reads "Their last known location is".
2. Confirm the message length stays under 160 characters for typical name/coord values (the change adds 4 characters: "Their" vs "His" = +2, "known" vs "know" = +1, net +3).
3. `cd backend && npx tsc --noEmit` — no type errors (this is a string literal change, no type impact expected).

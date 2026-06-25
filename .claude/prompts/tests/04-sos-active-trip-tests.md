# Test Prompt 04 — SOS & Active Trip Tests

Agent: qa-engineer

## Before writing anything

Read these files:
- mobile/src/services/SOSService.ts
- mobile/jest.config.js
- mobile/src/services/__tests__/CircleService.test.ts (if exists)
- CLAUDE.md

## Task

Write `mobile/src/services/__tests__/SOSService.test.ts`.

## Unit test coverage

### GPS accuracy
- `triggerSOS` must request `Accuracy.High` — assert the mock receives it
- Must not use `Accuracy.Balanced` or `Accuracy.Low`

### Internet path (happy)
- `triggerSOS` returns `{ success: true, notified: N, total: N }`
- Backend called with correct body: `tripId`, `lat`, `lng`, `contactIds`
- JWT from session passed in `Authorization: Bearer` header

### Offline fallback
- When `fetch` throws (network error), falls back to `Linking.openURL`
- Fallback URL starts with `sms:`
- Returns `{ success: false, notified: 0, total: N }` (or similar graceful shape)

### All contacts notified
- Mock 3 contacts — assert backend receives all 3 `contactIds`

### Rate limit fallback
- When backend returns 429, triggers SMS fallback via `Linking.openURL`

### cancelSOS
- Calls PATCH endpoint with correct eventId and JWT
- Returns `{ success: true }` on 200
- Returns `{ success: false, error }` on 404

## Manual test procedures

Include a comment block at the bottom of the file describing manual QA steps:

```
MANUAL TEST: SOS trigger
1. Start a trip with at least 1 contact
2. Tap SOS once — spinner should appear immediately
3. Verify red banner appears within 3 seconds
4. Check backend logs for SOS event insert
5. Confirm SMS sent (check AT dashboard or backend logs)
6. Tap Cancel SOS — banner returns to green

MANUAL TEST: End trip
1. Tap End trip
2. Verify trip status updates in Supabase dashboard
3. Verify HomeScreen returns to idle state
4. Verify no further GPS pings after trip ends
```

## Rules
- TypeScript strict
- Mock `expo-location`, `fetch`, `Linking`, and `../lib/supabase`
- No real network calls in unit tests
- Each test must be independent — no shared mutable state

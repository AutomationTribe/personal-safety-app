# Mobile Prompt 05 — SOSService Rewrite

Agent: mobile-engineer

## Before writing anything

Read these files:
- mobile/src/services/SOSService.ts (if it exists)
- mobile/src/lib/supabase.ts
- mobile/src/services/CircleService.ts
- CLAUDE.md

## Task

Rewrite `mobile/src/services/SOSService.ts` using the module pattern (no class).

## Types

```typescript
export interface SOSResult {
  success: boolean;
  eventId?: string;
  notified: number;
  total: number;
  error?: string;
}

export interface SOSContact {
  id: string;
  name: string;
  phone: string;
}
```

## Functions to export

### triggerSOS(tripId: string, contactIds: string[]): Promise<SOSResult>

1. Get current GPS position at `Accuracy.High`
2. Get Supabase session for JWT
3. POST to `${EXPO_PUBLIC_BACKEND_URL}/api/v1/sos` with JWT in Authorization header
4. On success return `{ success: true, eventId, notified, total }`
5. On network failure fall back to SMS via `Linking.openURL('sms:...')`

SMS fallback body:
```
🚨 SOS: I need help. My location: https://maps.google.com/?q=[lat],[lng] — Hadin Safety App
```

### cancelSOS(eventId: string): Promise<{ success: boolean; error?: string }>

PATCH `${EXPO_PUBLIC_BACKEND_URL}/api/v1/sos/${eventId}/cancel` with JWT.
Returns `{ success: true }` or `{ success: false, error }`.

### getSOSContacts(contactIds: string[]): Promise<SOSContact[]>

Fetch from Supabase `trusted_contacts` table filtered to provided `contactIds`.
Returns array of `{ id, name, phone }`.

## Rules
- TypeScript strict, no any
- `Accuracy.High` — never use Balanced for SOS
- Never throw — always return SOSResult
- Log every SOS trigger to console regardless of outcome
- Import GPS from `expo-location`, not react-native-background-geolocation
- Never call AT SMS SDK directly — only via backend
- Never expose service role key

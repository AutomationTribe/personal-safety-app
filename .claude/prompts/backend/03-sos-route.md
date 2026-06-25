# Backend Prompt 03 — SOS Route

Agent: backend-engineer

## Before writing anything

Read these files:
- backend/src/routes/contacts.ts
- backend/src/middleware/auth.ts
- backend/src/middleware/rateLimit.ts
- backend/src/services/africastalking.ts
- CLAUDE.md

## Task

Build two routes in `backend/src/routes/sos.ts`.

### POST /api/v1/sos

Middleware: `requireAuth`, `sosRateLimit`

Request body (Zod):
```typescript
{
  tripId: z.string().uuid(),
  lat: z.number(),
  lng: z.number(),
  contactIds: z.array(z.string().uuid()).min(1),
}
```

Steps:
1. Insert a row into `sos_events` with `user_id`, `trip_id`, `lat`, `lng`, `triggered_at: new Date()`
2. Fetch phone numbers for all `contactIds` from `trusted_contacts` using the Supabase service client
3. Send SMS to every contact via AT using `Promise.allSettled` — never await serially
4. Log every send attempt regardless of outcome (success or failure)
5. Return `200 { success: true, eventId, notified: number, total: number }`

**Critical rules:**
- Never block the response on SMS delivery — fire and return
- Always return 200 even if all SMS fail
- Log the SOS event to console before returning, always
- Use `sosRateLimit`: max 3 per user per 10 minutes

SMS message format:
```
🚨 SOS from [userName]: I need help. My last location: https://maps.google.com/?q=[lat],[lng] — Hadin Safety App
```

### PATCH /api/v1/sos/:id/cancel

Middleware: `requireAuth`

Steps:
1. Set `cancelled_at = now()` on the sos_event where `id = :id AND user_id = auth user AND cancelled_at IS NULL`
2. If no row matched, return `404 { error: 'SOS event not found', code: 'NOT_FOUND' }`
3. Return `200 { success: true }`

### Rules
- TypeScript strict, no any
- Error shape: `{ error: string, code: string }`
- Use Supabase service client from `lib/supabase.ts`
- Export router as default

# Workflow: Active Trip Redesign

Run these 5 steps in order. Do not proceed to the next step until the verify command passes.

---

## Step 1 — Database

```bash
claude "Read .claude/agents/database-engineer.md then read CLAUDE.md. Add these columns if they don't exist: contact_ids uuid[] to trips table, cancelled_at timestamptz to sos_events table. Enable Realtime on both tables. Write the SQL to supabase/migrations/007-active-trip-columns.sql"
```

**Verify:**
```bash
cat supabase/migrations/007-active-trip-columns.sql
# Must contain: contact_ids, cancelled_at, supabase_realtime
```

---

## Step 2 — Backend SOS Route

```bash
claude "Read .claude/agents/backend-engineer.md then execute .claude/prompts/backend/03-sos-route.md"
```

**Verify:**
```bash
cd backend && npx tsc --noEmit && echo "TypeScript OK"
curl -X POST http://localhost:3001/api/v1/sos \
  -H "Content-Type: application/json" \
  -d '{"tripId":"test"}' \
  # Expect 401 (auth required) — means route is registered
```

---

## Step 3 — SOSService

```bash
claude "Read .claude/agents/mobile-engineer.md then execute .claude/prompts/services/05-SOSService-update.md"
```

**Verify:**
```bash
cd mobile && npx tsc --noEmit && echo "TypeScript OK"
grep -n "Accuracy.High" mobile/src/services/SOSService.ts
# Must print at least one match
```

---

## Step 4 — Screen Redesign

```bash
claude "Read .claude/agents/mobile-engineer.md then execute .claude/prompts/screens/12-ActiveTripRedesign.md"
```

**Verify:**
```bash
cd mobile && npx tsc --noEmit && echo "TypeScript OK"
# Then manually start a trip in Expo Go and verify:
# - Green banner visible
# - Background chip present
# - Circle contacts shown
# - SOS button single tap triggers spinner
```

---

## Step 5 — Tests

```bash
claude "Read .claude/agents/qa-engineer.md then execute .claude/prompts/tests/04-sos-active-trip-tests.md"
```

**Verify:**
```bash
cd mobile && npm test -- SOSService
# All tests must pass
```

---

## Completion checklist

- [ ] `007-active-trip-columns.sql` applied to Supabase
- [ ] `contact_ids` column exists on trips table
- [ ] `cancelled_at` column exists on sos_events table
- [ ] Realtime enabled on both tables
- [ ] `POST /api/v1/sos` returns 401 without auth, 200 with valid JWT + trip
- [ ] `PATCH /api/v1/sos/:id/cancel` updates `cancelled_at`
- [ ] `SOSService.triggerSOS` uses `Accuracy.High`
- [ ] SMS fallback fires when backend unreachable
- [ ] Active trip banner is green, turns red on SOS
- [ ] Single tap triggers SOS (no double-tap required)
- [ ] Cancel SOS resets banner to green
- [ ] Background chip works on Android (BackHandler) and iOS (Alert)
- [ ] All unit tests pass
- [ ] TypeScript strict — no errors in mobile or backend

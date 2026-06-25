# Workflow: Build SOS System

## This is the most critical feature in Hadin.
## A failure here puts users at risk. Test exhaustively.

### Step 1 — Database Engineer
Migration: 005_sos_events.sql
Verify: Realtime enabled on sos_events

### Step 2 — Mobile Engineer
Build SOSService.ts
Verify: Internet path + SMS fallback both work on device

### Step 3 — Backend Engineer
Build POST /api/v1/sos route
Verify: All circle contacts receive SMS within 30 seconds

### Step 4 — QA Engineer (mandatory before ship)
Run ALL SOS test cases from qa-engineer.md
Battery test: SOS fires after 4 hours background tracking
Network test: SOS fires with 0% connectivity

### Completion checklist
- [ ] SOS writes to sos_events table
- [ ] All notify_on_sos=true contacts receive SMS
- [ ] SMS fallback fires when internet unavailable
- [ ] GPS coords attached to every SOS event
- [ ] SOS button requires 3-second hold (no accidental fires)
- [ ] sos_events Realtime triggers dashboard alert
- [ ] Rate limit prevents spam (max 3 per 10 min)
- [ ] Battery consumption tested after SOS trigger

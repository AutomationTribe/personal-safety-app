# Manual: Start Trip Battery Test

## Setup
- Fully charged device (100%)
- Expo Go installed
- Record battery % at start

## Steps
1. Log in to Hadin
2. Note battery level
3. Start a trip (Lagos → Abuja, 2 contacts)
4. Lock screen
5. Wait 30 minutes
6. Note battery level — target: less than 5% drain
7. Unlock, verify ping appeared in Supabase dashboard
8. Turn on airplane mode
9. Wait for next ping interval
10. Turn off airplane mode
11. Verify ping synced to Supabase (flushQueue triggered)
12. Trigger SOS hold (3 seconds)
13. Verify SMS received on test number

## Pass criteria
- Less than 5% battery drain per 30 minutes
- Ping appears in Supabase within 2 minutes of interval
- Offline ping syncs within 60 seconds of connectivity restore
- SOS SMS received within 30 seconds of trigger
- No app crash during any step

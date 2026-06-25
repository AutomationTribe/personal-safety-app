# Prompt: POST /api/v1/trips/notify-start

## Agent
Backend Engineer — read .claude/agents/backend-engineer.md first.

## Read before writing
- CLAUDE.md
- backend/src/app.ts
- backend/src/middleware/auth.ts
- backend/src/services/africastalking.ts
- backend/src/services/supabase.ts
- backend/src/routes/contacts.ts

## Goal
Build the POST /api/v1/trips/notify-start route.
Called fire-and-forget from StartTripModal when a trip starts.

## Request body (Zod)
{
  tripId: string
  origin: string
  destination: string
  contactIds: string[]   // trusted_contact IDs to notify
}

## What the route does
1. Validate request body
2. Verify auth JWT
3. Fetch the selected contacts from trusted_contacts table
   where id IN (contactIds) AND user_id = req.user.id
   (user_id check prevents notifying other users' contacts)
4. Get the user's display name from profiles table
5. For each contact where notify_on_trip_start = true
   OR where contactId is in the request contactIds array:
   Send SMS via Africa's Talking:
   "Hi [contactName], [userName] has started a trip from
   [origin] to [destination] and is sharing their live
   location with you. Powered by Hadin."
6. Return 200 { success: true, notified: number }

## SMS rules
- Send concurrently (Promise.all) not sequentially
- Max 160 chars — truncate origin/destination if needed
- Log each send attempt with contact name and result
- If one SMS fails, continue with others (don't fail all)
- Return { success: true } even if some SMSes fail —
  log failures but don't surface to mobile

## Rules
- TypeScript strict, no any
- Auth middleware required
- Zod validation
- Error shape: { error: string, code: string }
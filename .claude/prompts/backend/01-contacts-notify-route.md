# Prompt: POST /api/v1/contacts/notify

## Agent
Backend Engineer — read .claude/agents/backend-engineer.md first.

## Read before writing
- CLAUDE.md
- backend/src/app.ts
- backend/src/middleware/auth.ts
- backend/src/services/africastalking.ts
- backend/src/services/supabase.ts

## Goal
Build the POST /api/v1/contacts/notify route.
This is called by CircleService.notifyContactViaSMS()
when a user adds someone to their circle.

## Request body (validate with Zod)
{
  contactPhone: string   // Nigerian E.164 +234xxxxxxxxxx
  contactName: string
  userName: string       // the Hadin user's display name
}

## What the route does
1. Validate request body with Zod
2. Verify auth JWT via auth middleware
3. Send SMS via Africa's Talking:
   To: contactPhone
   From: HADIN (alphanumeric sender ID)
   Message (max 160 chars):
   "Hi [contactName], [userName] added you to their
   Hadin safety circle. You'll be notified if they
   need help while travelling. hellohadin.netlify.app"
4. Log the attempt (console.log in dev, structured in prod)
5. Return 200 { success: true } on delivery
6. Return 500 { error: string, code: 'SMS_FAILED' } on AT error

## Africa's Talking rules
- Use sandbox credentials in NODE_ENV=development
- Use live credentials in NODE_ENV=production
- Sender ID: AT_SENDER_ID env var (default HADIN)
- Always log delivery status from AT response
- Never throw — catch AT errors and return structured response

## Rate limiting
Apply rate limit: max 10 requests per user per hour.
Prevents SMS spam if the add-contact button is tapped repeatedly.

## Rules
- TypeScript strict, no any
- Auth middleware applied — must be authenticated
- Zod validation before any business logic
- Error shape: { error: string, code: string }
# Fix: SMS Notification on Signup

## Bug
After a user successfully creates an account, no welcome SMS is sent to their
registered phone number. The phone is stored in `raw_user_meta_data.phone`
during `supabase.auth.signUp()` but nothing reads it or triggers an SMS.

## Root cause
There was no backend endpoint or trigger for a post-signup SMS. The signup
flow (mobile → Supabase Auth directly) bypasses the backend entirely, so the
backend had no opportunity to hook in.

## Affected files
- `backend/src/routes/auth.ts` — NEW: welcome-sms endpoint
- `backend/src/app.ts` — registers the new auth router

## Fix

### New endpoint: POST /api/v1/auth/welcome-sms

**Before:** endpoint did not exist.

**After:**
- Requires a valid Bearer token (new user's session, obtained from `signUp()` response)
- Reads `req.user.user_metadata.phone` (set by mobile during signUp options)
- Guards: if phone missing or not a Nigerian +234 number, returns 400 — no SMS sent
- Normalizes: strips non-digits, checks for `0XXXXXXXXXX` → `+234XXXXXXXXXX`
  (defensive — SignupScreen already normalizes, but backend must not trust mobile)
- Calls `sendSMS(phone, welcomeMessage)`
- Returns `{ success: true, messageId }` or `{ error, code }`
- AT failure is logged but does NOT return a 5xx (welcome SMS is non-critical;
  must not block the user from proceeding to the subscription screen)

### Message text
```
Welcome to Hadin! Your account is ready. Stay protected on every journey. hellohadin.netlify.app
```

### app.ts registration
```typescript
import authRouter from './routes/auth';
app.use('/api/v1/auth', authRouter);
```

## Edge cases
| Scenario | Behaviour |
|---|---|
| Google signup — no phone in metadata | Returns 400 `PHONE_MISSING`; mobile ignores (fire-and-forget) |
| Phone not in +234 format | Returns 400 `INVALID_PHONE`; mobile ignores |
| AT API failure (network or bad key) | Logs warning, returns 200 `{ success: false, error }` — non-blocking |
| User calls endpoint twice | Sends SMS twice — acceptable; no de-dupe needed at launch |
| No session (token expired) | requireAuth returns 401 — mobile should not reach this |

## Environment variables
Already required by africastalking.ts — no new vars needed:
- `AT_API_KEY`
- `AT_USERNAME`
- `AT_SENDER_ID` (optional — uses shared number if unset)

## Restart required?
Yes — backend must be restarted to pick up the new route. No migrations needed.

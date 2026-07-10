# Fix: SMS Notification on Signup — Mobile

## Mobile change
`mobile/src/screens/auth/SignupScreen.tsx` — after `supabase.auth.signUp()`
succeeds and the identities guard passes, fire `POST /api/v1/auth/welcome-sms`
as **fire-and-forget** using the session token from `data.session`.

The call is intentionally not awaited in a blocking way. If it fails, the
user is already navigating to the Subscription screen — the welcome SMS is
non-critical and must never block or error the signup flow.

## What changes in mobile
- After the `data.user?.identities?.length === 0` guard (duplicate check),
  add a fire-and-forget fetch to the welcome-sms endpoint.
- Uses `data.session?.access_token` — available immediately after signUp
  when email confirmation is disabled.
- Errors are console.warn only — never shown to user.

## What does NOT change
- Navigation still happens via AppNavigator's `onAuthStateChange`
- No new state variables
- No UI changes

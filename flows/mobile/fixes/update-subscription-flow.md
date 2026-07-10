# Fix: Update Subscription Flow — Mobile

## What was broken
`DirectPaymentScreen` showed a summary card + "Pay ₦X" button and waited for
the user to tap before opening Paystack. The user had already chosen a plan on
`SubscriptionScreen` — the second tap was redundant and buried the payment
method selection (card / bank transfer / USSD) behind an unnecessary step.

## What changed

### DirectPaymentScreen.tsx — MODIFIED

**Before:**
- `handlePay` only called when user taps "Pay ₦X →" button
- Screen mounted idle — user must tap to start

**After:**
- `handlePay` wrapped in `useCallback`
- `useEffect` calls `handlePay()` on mount — Paystack checkout opens automatically
- "Pay ₦X →" button replaced by a "Try again" button shown **only when there is
  an error** (allows retry without navigating back)
- While auto-initiating: summary card visible + loading spinner in button area
  with label "Opening checkout…"
- WebView closes → user is back on summary with retry option

## Screens NOT affected
- SubscriptionScreen — no change
- TrialOfferScreen — no change
- SuccessScreen — no change
- AppNavigator.tsx — no change

## Navigation changes
None. Flow is still:
`SubscriptionScreen → DirectPaymentScreen → [Paystack WebView auto-opens] → SuccessScreen`

## Updated flow (after fix)
1. User taps plan on SubscriptionScreen
2. DirectPaymentScreen mounts → summary card shows → spinner "Opening checkout…"
3. `/api/v1/payments/init` called automatically
4. Paystack WebView opens showing card / bank transfer / USSD options
5. User selects method, completes payment
6. Callback URL intercepted → `/api/v1/payments/verify` called
7. Navigate to SuccessScreen `{ type: 'subscriber' }`

**Error path:**
- Init or verify fails → error banner + "Try again" button → tapping retries `/init` from scratch

# Mobile Subscription Flow

## Entry Points
- After email/password signup → routed to `SubscriptionScreen` by `resolveInitialRoute` (subscription_status = 'free', profile row absent)
- After Google signup → routed to `PhoneCaptureScreen` first, then `SubscriptionScreen`
- Settings → Subscription row → `SubscriptionScreen` (for managing plan)

## Screens Involved
1. SubscriptionScreen
2. DirectPaymentScreen
3. TrialOfferScreen
4. SuccessScreen

---

## 1. SubscriptionScreen

### Purpose
Plan selection page. Shown to all unsubscribed users. Acts as the Profile tab for unsubscribed users.

### Layout
- Header: "Choose Your Protection" + subtitle
- Plan card 1 — STANDARD (Essential Safety, ₦20,000/yr)
- Plan card 2 — PREMIUM PROTECTION with RECOMMENDED badge (Complete Peace of Mind, ₦35,000/yr)
- "LOG OUT" link at bottom
- Bottom tab bar: Safety | Shield | Circle | Profile (Profile active)

### Plan Features
**Basic (Essential Safety):**
- SOS Trigger
- Live Location Sharing
- 1 Emergency Contact

**Elite (Complete Peace of Mind):**
- Everything in Basic, plus:
- 24/7 AI Monitoring
- Family Circle (up to 5)
- Priority Emergency Response
- Safety Insights

### Navigation Transitions
| Action | Result |
|---|---|
| "Select Basic Plan" | → `DirectPaymentScreen` with `{ plan: 'basic' }` |
| "Select Elite Plan" | → `DirectPaymentScreen` with `{ plan: 'elite' }` |
| "LOG OUT" | → Show trial offer bottom sheet |
| Hardware back | → Show trial offer bottom sheet |
| Any tab press (Safety/Shield/Circle) | → Show trial offer bottom sheet |

### Trial Offer Bottom Sheet
Triggered by: LOG OUT, hardware back, non-Profile tab press.

**Content:**
- Shield icon
- "Before you go…"
- "8 Days Free" with ONE-TIME OFFER badge
- "Full access · No charge today · ₦35,000/yr after"
- Button: "Try free for 8 days" → `TrialOfferScreen`
- Button: "No thanks" → behaviour depends on trigger:
  - LOG OUT trigger → sign out user
  - Back trigger → exit app
  - Tab trigger → dismiss modal, stay on screen

### UI States
- Default: both plan cards rendered, LOG OUT link visible
- Modal open: bottom sheet overlaid, taps outside dismissed

### Supabase / Backend Calls
- None on this screen (no data loading required, user already authenticated)

---

## 2. DirectPaymentScreen

### Purpose
Paystack WebView payment flow for one-time subscription.

### Route Params
```typescript
{ plan: 'basic' | 'elite' }
```

### Layout
- Back arrow + header with plan name and price
- Summary card: Plan, Billing (Yearly), Charged today (₦20,000 or ₦35,000)
- "Secured by Paystack" trust badge
- Loading spinner (auto-initiating) OR error banner + "Try again" button

### Back Button Behaviour
- Navigates back to SubscriptionScreen

### Flow
1. Screen mounts → automatically calls POST `/api/v1/payments/init` with `{ plan }`
2. Backend returns `{ authorization_url, reference }`
3. Paystack WebView opens automatically showing payment method options (card / bank transfer / USSD)
4. WebView intercepts navigation to `https://hadin.app/payment/callback`
5. Extracts `reference` from callback URL
6. POST `/api/v1/payments/verify` with `{ reference }`
7. Backend confirms success → updates `profiles.subscription_status = 'active'`, `profiles.plan`, `profiles.next_billing_date`
8. Navigate to `SuccessScreen` with `{ type: 'subscriber' }`

### UI States
| State | Description |
|---|---|
| Auto-initiating (on mount) | Summary card visible + spinner "Opening checkout…" |
| WebView open | Full-screen Modal with Paystack checkout |
| Verifying | Spinner + "Confirming payment…" |
| Error | Red error banner + "Try again" button (retries /init) |
| Success | Navigation to SuccessScreen |

> Note: There is no idle "Pay" button state. Checkout opens automatically on mount.

### Error Messages
- Not authenticated: "Not authenticated"
- Init fails: Backend error message or "Could not start payment"
- Reference missing after callback: "Payment reference missing. Contact support if charged."
- Verify fails: Backend error message or "Could not confirm payment"

### Supabase / Backend Calls
- `GET /api/v1/payments/init` (POST, Bearer token)
- `GET /api/v1/payments/verify` (POST, Bearer token, body: `{ reference }`)
- Token sourced from `supabase.auth.getSession()`

---

## 3. TrialOfferScreen

### Purpose
Confirms and activates the 8-day free trial. No card required.

### Layout
- Back arrow
- "ONE-TIME OFFER" badge
- Headline: "Try Hadin free for 8 days."
- Subtitle: "No charge for 8 days. Start protecting yourself today."
- Timeline card:
  - Today — Day 1: Full access, no charge
  - Day 6 — Reminder: We'll remind you before trial ends
  - Day 9 — ₦35,000 charged: Renews yearly unless cancelled
- "Start 8-day trial" CTA button
- Loading spinner during activation
- Error banner if backend call fails

### Back Button Behaviour
- Navigates back to SubscriptionScreen

### Flow
1. User taps "Start 8-day trial"
2. POST `/api/v1/payments/trial/start` with Bearer token
3. Backend sets `subscription_status = 'trial'`, `trial_start = now`, `trial_end = now + 8 days`
4. Navigate to `SuccessScreen` with `{ type: 'trial' }`

### Error Messages
- Session expired: "Session expired. Please sign in again."
- Backend fail: "Could not start trial. Please try again."

---

## 4. SuccessScreen

### Purpose
Confirms subscription activation. Clears navigation stack.

### Route Params
```typescript
{ type: 'subscriber' | 'trial' }
```

### Content
- Shield icon in circle
- "You're protected."
- Subtitle about circle
- Badge: "Free trial · 8 days remaining" OR "Hadin Pro · Active"
- "Go to Hadin →" button → resets stack to `Home`
- Fine print note with billing info

### Navigation
- "Go to Hadin →" → `CommonActions.reset({ index: 0, routes: [{ name: 'Home' }] })`
- No back button (stack is reset on entry)

---

## Error State Summary

| Screen | Error | User-visible message |
|---|---|---|
| DirectPayment | Token missing | "Not authenticated" |
| DirectPayment | Init 500 | "Could not start payment" |
| DirectPayment | No reference | "Payment reference missing…" |
| DirectPayment | Verify fail | "Payment could not be confirmed" |
| TrialOfferScreen | No session | "Session expired. Please sign in again." |
| TrialOfferScreen | Backend fail | "Could not start trial. Please try again." |

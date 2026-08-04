# SEC-03 — Derive subscription plan from verified amount, not client metadata

## What to fix

**File:** `backend/src/routes/payments.ts` (line 151)

```ts
const plan = data.data.metadata?.plan ?? 'elite';
```

The plan stored in `profiles` comes from `metadata.plan` inside the Paystack transaction response. That metadata was originally set by the **mobile client** when it initialized the transaction. A malicious user could initialize a transaction for the `basic` plan, pay the basic amount, and then call `/verify` — but since the metadata says `elite`, they'd receive an elite subscription for basic price.

The same bug exists in the webhook handler at line 247:
```ts
const plan = (event.data.metadata as Record<string, string> | undefined)?.plan ?? 'elite';
```

## Why it matters

The server already has the verified `amount` field from Paystack. That value cannot be tampered with by the client. Using metadata instead of amount allows plan tier fraud at the cost of one plan tier's price difference (₦15,000/year per user).

The `PLAN_AMOUNTS` map is already defined at the top of `payments.ts` — use it in reverse.

## Exact fix

Add a reverse-lookup helper after the `PLAN_AMOUNTS` definition:

```ts
function planFromAmount(amount: number): string {
  for (const [plan, planAmount] of Object.entries(PLAN_AMOUNTS)) {
    if (planAmount === amount) return plan;
  }
  return 'elite'; // unknown amount → default to highest tier (safe fallback)
}
```

**In `/verify` handler — before (line 151):**
```ts
const plan = data.data.metadata?.plan ?? 'elite';
```

**After:**
```ts
const plan = planFromAmount(data.data.amount);
```

**In `/webhook` handler — before (line 247):**
```ts
const plan = (event.data.metadata as Record<string, string> | undefined)?.plan ?? 'elite';
```

**After:**

First, extend the inline type for `event.data` to include `amount` (it is missing from the current type definition):

```ts
const event = req.body as {
  event: string;
  data: {
    reference: string;
    status: string;
    amount: number;
    metadata?: { user_id?: string };
  };
};
```

Then replace the `plan` line with:

```ts
const plan = planFromAmount(event.data.amount);
```

The full updated `charge.success` block inside the webhook handler should read:

```ts
if (event.event === 'charge.success') {
  const userId = event.data.metadata?.user_id;
  const plan = planFromAmount(event.data.amount);
  if (userId) {
    const nextBillingDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const { error: whErr } = await supabaseAdmin
      .from('profiles')
      .upsert(
        { id: userId, subscription_status: 'active', plan, next_billing_date: nextBillingDate },
        { onConflict: 'id' },
      );
    if (whErr) {
      console.error('[webhook] profile update error:', whErr);
    } else {
      console.log(`[webhook] subscription activated via webhook for user ${userId} plan=${plan}`);
    }
  }
}
```

## Files to touch

- `backend/src/routes/payments.ts`

## Test steps

1. Initialize a `basic` plan transaction; manually edit the Paystack test transaction's metadata to say `elite` (use Paystack dashboard or intercept the verify response); call `/verify` — confirm the profile is written with `plan: 'basic'`, not `elite`.
2. Initialize an `elite` plan transaction, complete it, call `/verify` — confirm profile has `plan: 'elite'`.
3. Send a webhook with `amount: 2000000` (basic) — confirm profile written with `plan: 'basic'`.
4. `cd backend && npx tsc --noEmit` — no type errors.

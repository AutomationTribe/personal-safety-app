# SEC-14 — Verify user exists before webhook upsert

## What to fix

**File:** `backend/src/routes/payments.ts` (line 246, inside the `/webhook` handler)

After the `charge.success` event is received, the handler takes `user_id` from `event.data.metadata?.user_id` and immediately upserts into `profiles` with no check that the user actually exists in `auth.users`. This means:
- A forged or replayed webhook (bypassing SEC-02) with a non-existent UUID would create a dangling `profiles` row.
- After SEC-02 is fixed, this becomes a lower-risk but still hygienically wrong operation: Paystack metadata could contain a stale or manually crafted `user_id`.

## Why it matters

Upserting a `profiles` row for a user_id that doesn't exist in `auth.users` creates orphaned data. Depending on foreign key constraints, it may also cause integrity errors or — if FK is not enforced — silent data corruption. A verified existence check is a minimal sanity guard on untrusted webhook data.

Note: implement SEC-02 first. This fix builds on the assumption that the signature has already been verified before reaching this point.

## Exact fix

After the signature verification block and before the `charge.success` handling, add a user existence check using `supabaseAdmin` (service role is needed to query `auth.users`):

**In the `/webhook` handler, inside the `if (event.event === 'charge.success')` block — before:**
```ts
if (event.event === 'charge.success') {
  const userId = event.data.metadata?.user_id;
  const plan = planFromAmount(event.data.amount); // after SEC-03 is applied
  if (userId) {
    const nextBillingDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const { error: whErr } = await supabaseAdmin
      .from('profiles')
      .upsert(
        { id: userId, subscription_status: 'active', plan, next_billing_date: nextBillingDate },
        { onConflict: 'id' },
      );
```

**After:**
```ts
if (event.event === 'charge.success') {
  const userId = event.data.metadata?.user_id;
  const plan = planFromAmount(event.data.amount); // after SEC-03 is applied
  if (userId) {
    // Verify the user exists in auth.users before writing to profiles
    const { data: authUser, error: userLookupErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userLookupErr || !authUser.user) {
      console.warn(`[webhook] user_id ${userId} not found in auth.users — skipping upsert`);
      // Still return 200 so Paystack doesn't retry — the event is invalid, not a server error
      res.json({ received: true });
      return;
    }

    const nextBillingDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const { error: whErr } = await supabaseAdmin
      .from('profiles')
      .upsert(
        { id: userId, subscription_status: 'active', plan, next_billing_date: nextBillingDate },
        { onConflict: 'id' },
      );
```

The `supabaseAdmin.auth.admin.getUserById` call requires the service-role key, which `supabaseAdmin` already uses.

## Files to touch

- `backend/src/routes/payments.ts`

## Test steps

1. Send a correctly signed `charge.success` webhook with a valid `user_id` from `auth.users` — expect the profile updated and 200 `{ received: true }`.
2. Send a correctly signed `charge.success` webhook with a random UUID that does not exist in `auth.users` — expect 200 `{ received: true }` (so Paystack doesn't retry) but NO profile row created; confirm via Supabase dashboard.
3. Send a webhook with no `user_id` in metadata — the existing `if (userId)` guard already handles this; confirm behaviour unchanged (no upsert, 200 returned).
4. `cd backend && npx tsc --noEmit` — no type errors.

## Dependency

Implement **SEC-02** before this fix — the user existence check is only meaningful after the signature has been verified.

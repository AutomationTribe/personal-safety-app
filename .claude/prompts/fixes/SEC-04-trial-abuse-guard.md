# SEC-04 — Guard trial endpoint against repeat activation

## What to fix

**File:** `backend/src/routes/payments.ts` (line 179)

`POST /api/v1/payments/trial/start` unconditionally upserts a new `trial` subscription for any authenticated user. Because `upsert` with `onConflict: 'id'` simply overwrites existing rows, a user can call this endpoint repeatedly to extend their trial indefinitely or reset a cancelled subscription back to trial status.

## Why it matters

An 8-day trial is a business-critical gate. Without this guard, any user can avoid ever paying by calling this endpoint once a week. It also allows a previously-active paid subscriber to regress their account back to trial status.

## Exact fix

Before the upsert, read the user's current `profiles` row and check `trial_start` and `subscription_status`. If either indicates the user has already used a trial or currently has an active/paid subscription, return 409.

**In the `/trial/start` handler — insert this block before the `upsert` call:**

```ts
// Guard: reject if user already had a trial or has an active subscription
const { data: existing } = await supabaseAdmin
  .from('profiles')
  .select('trial_start, subscription_status')
  .eq('id', user.id)
  .single();

if (existing) {
  const row = existing as { trial_start: string | null; subscription_status: string | null };
  if (row.trial_start) {
    res.status(409).json({ error: 'Trial already used', code: 'TRIAL_EXHAUSTED' });
    return;
  }
  if (row.subscription_status === 'active') {
    res.status(409).json({ error: 'Account already has an active subscription', code: 'TRIAL_EXHAUSTED' });
    return;
  }
}
```

The full handler after the fix should look like:

```ts
router.post('/trial/start', requireAuth as unknown as Parameters<typeof router.post>[1], async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;

    // Guard: reject if trial already used or subscription is active
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('trial_start, subscription_status')
      .eq('id', user.id)
      .single();

    if (existing) {
      const row = existing as { trial_start: string | null; subscription_status: string | null };
      if (row.trial_start) {
        res.status(409).json({ error: 'Trial already used', code: 'TRIAL_EXHAUSTED' });
        return;
      }
      if (row.subscription_status === 'active') {
        res.status(409).json({ error: 'Account already has an active subscription', code: 'TRIAL_EXHAUSTED' });
        return;
      }
    }

    const now = new Date();
    const trialEnd = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);

    const { error: dbError } = await supabaseAdmin
      .from('profiles')
      .upsert(
        {
          id: user.id,
          subscription_status: 'trial',
          plan: 'elite',
          trial_start: now.toISOString(),
          trial_end: trialEnd.toISOString(),
        },
        { onConflict: 'id' },
      );
    // ... rest unchanged
  }
});
```

## Files to touch

- `backend/src/routes/payments.ts`

## Test steps

1. Call `POST /api/v1/payments/trial/start` for a brand new user (no `trial_start`) — expect 200 `{ success: true }`.
2. Call the same endpoint again for the same user — expect 409 `{ code: 'TRIAL_EXHAUSTED' }`.
3. Set `subscription_status = 'active'` for a user directly in Supabase; call the endpoint — expect 409 `{ code: 'TRIAL_EXHAUSTED' }`.
4. New user with a null profile row (profile created on first upsert) — confirm the `existing` null path still grants the trial correctly (the `if (existing)` guard only fires when a row exists).
5. `cd backend && npx tsc --noEmit` — no type errors.

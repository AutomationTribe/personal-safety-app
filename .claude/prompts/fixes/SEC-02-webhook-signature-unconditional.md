# SEC-02 — Paystack webhook signature validation must be unconditional

## What to fix

**File:** `backend/src/routes/payments.ts` (lines 224–234)

The signature check is wrapped in `if (rawBody && PAYSTACK_SECRET)`. If either value is falsy (missing env var, middleware misconfiguration), the block is skipped entirely and the webhook activates subscriptions with zero validation. An attacker can send a crafted `charge.success` event with any `user_id` and grant themselves a subscription.

## Why it matters

Paystack webhook signature validation is the only barrier between an unauthenticated HTTP POST and a subscription write to the `profiles` table. Making it optional is equivalent to having no security on this endpoint.

## Exact fix

**`backend/src/routes/payments.ts` — before (lines 219–234):**
```ts
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-paystack-signature'] as string;
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

    if (rawBody && PAYSTACK_SECRET) {
      const hash = crypto
        .createHmac('sha512', PAYSTACK_SECRET)
        .update(rawBody)
        .digest('hex');

      if (hash !== signature) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }
```

**After:**
```ts
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-paystack-signature'] as string;
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

    if (!rawBody || !PAYSTACK_SECRET) {
      console.error('[webhook] Missing rawBody or PAYSTACK_SECRET — rejecting');
      res.status(500).json({ error: 'Webhook misconfigured' });
      return;
    }

    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (hash !== signature) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
```

## Files to touch

- `backend/src/routes/payments.ts`

## Test steps

1. Send a POST to `/api/v1/payments/webhook` with a valid `charge.success` body but a wrong or missing `x-paystack-signature` header — expect 401.
2. Temporarily unset `PAYSTACK_SECRET_KEY` in `.env`, restart the server, and send any webhook — expect 500 (not 200 or subscription activation).
3. Send a correctly signed webhook body (use Paystack's test mode webhook replay or sign a payload manually with `PAYSTACK_SECRET`) — expect 200 `{ received: true }` and the profile updated.
4. `cd backend && npx tsc --noEmit` — no type errors.

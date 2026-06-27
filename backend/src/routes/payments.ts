import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

const router = Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? '';

// ₦25,000 in kobo.
const SUBSCRIPTION_AMOUNT_KOBO = 2_500_000;
const SUBSCRIPTION_CURRENCY = 'NGN';

// Placeholder URL we intercept in the WebView to detect payment completion.
// Does not need to be a real page — the mobile app catches it before the browser loads it.
const CALLBACK_URL = 'https://hadin.app/payment/callback';

// Service-role client for writing to profiles without RLS restrictions
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

// ── Auth middleware ────────────────────────────────────────────────────────────

type AuthedRequest = Request & { user: { id: string; email?: string } };

async function requireAuth(req: Request, res: Response, next: () => void): Promise<void> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    return;
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    return;
  }

  (req as AuthedRequest).user = { id: user.id, email: user.email };
  next();
}

// ── POST /api/v1/payments/init ────────────────────────────────────────────────
// Initializes a Paystack transaction and returns the checkout URL.
// The mobile app opens this URL in a WebView.

router.post('/init', requireAuth as unknown as Parameters<typeof router.post>[1], async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user.email,
        amount: SUBSCRIPTION_AMOUNT_KOBO,
        currency: SUBSCRIPTION_CURRENCY,
        callback_url: CALLBACK_URL,
        metadata: {
          user_id: user.id,
          plan: 'hadin_pro_yearly',
          custom_fields: [
            {
              display_name: 'Plan',
              variable_name: 'plan',
              value: 'Hadin Pro — Yearly',
            },
          ],
        },
      }),
    });

    const data = await response.json() as {
      status: boolean;
      message: string;
      data: { authorization_url: string; access_code: string; reference: string };
    };

    if (!data.status) {
      res.status(400).json({ error: data.message ?? 'Failed to initialize payment' });
      return;
    }

    res.json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
      access_code: data.data.access_code,
    });
  } catch (err) {
    console.error('[payments] /init error:', err);
    res.status(500).json({ error: 'Payment initialization failed' });
  }
});

// ── POST /api/v1/payments/verify ──────────────────────────────────────────────
// Verifies a completed Paystack transaction server-side.
// Called after the WebView detects the callback URL redirect.

const VerifySchema = z.object({ reference: z.string().min(1) });

router.post('/verify', requireAuth as unknown as Parameters<typeof router.post>[1], async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    const parsed = VerifySchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'reference is required' });
      return;
    }

    const { reference } = parsed.data;

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } },
    );

    const data = await response.json() as {
      status: boolean;
      message: string;
      data: { status: string; amount: number; currency: string };
    };

    if (!data.status || data.data.status !== 'success') {
      console.warn('[payments] verify failed:', data.message, data.data?.status);
      res.status(400).json({ error: 'Payment not successful', details: data.message });
      return;
    }

    // Activate subscription in Supabase
    const { error: dbError } = await supabaseAdmin
      .from('profiles')
      .upsert({ id: user.id, subscription_status: 'active' }, { onConflict: 'id' });

    if (dbError) {
      console.error('[payments] profile update error:', dbError);
      res.status(500).json({ error: 'Payment verified but subscription activation failed' });
      return;
    }

    console.log(`[payments] subscription activated for user ${user.id} — ref ${reference}`);
    res.json({ success: true, subscription_status: 'active' });
  } catch (err) {
    console.error('[payments] /verify error:', err);
    res.status(500).json({ error: 'Verification request failed' });
  }
});

// ── POST /api/v1/payments/webhook ─────────────────────────────────────────────
// Paystack sends this for every charge event.
// Acts as a safety net: even if the app closes mid-payment, the subscription
// gets activated when Paystack retries the webhook.
// Raw body is required for signature validation — see app.ts for setup.

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

    const event = req.body as {
      event: string;
      data: {
        reference: string;
        status: string;
        metadata?: { user_id?: string };
      };
    };

    if (event.event === 'charge.success') {
      const userId = event.data.metadata?.user_id;
      if (userId) {
        const { error: whErr } = await supabaseAdmin
          .from('profiles')
          .upsert({ id: userId, subscription_status: 'active' }, { onConflict: 'id' });
        if (whErr) {
          console.error('[webhook] profile update error:', whErr);
        } else {
          console.log(`[webhook] subscription activated via webhook for user ${userId}`);
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[payments] /webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;

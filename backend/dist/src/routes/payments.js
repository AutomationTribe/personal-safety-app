"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const supabase_1 = require("../lib/supabase");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? '';
// Plan amounts in kobo (₦1 = 100 kobo)
const PLAN_AMOUNTS = {
    basic: 2000000, // ₦20,000
    elite: 3500000, // ₦35,000
};
const SUBSCRIPTION_CURRENCY = 'NGN';
// Placeholder URL we intercept in the WebView to detect payment completion.
// Does not need to be a real page — the mobile app catches it before the browser loads it.
const CALLBACK_URL = 'https://hadin.app/payment/callback';
// Derive subscription plan from verified payment amount — never trust client metadata
function planFromAmount(amount) {
    for (const [plan, planAmount] of Object.entries(PLAN_AMOUNTS)) {
        if (planAmount === amount)
            return plan;
    }
    console.warn(`[payments] planFromAmount: unknown amount ${amount} — defaulting to elite`);
    return 'elite'; // unknown amount → default to highest tier (safe fallback)
}
// ── POST /api/v1/payments/init ────────────────────────────────────────────────
// Initializes a Paystack transaction and returns the checkout URL.
// The mobile app opens this URL in a WebView.
const InitSchema = zod_1.z.object({
    plan: zod_1.z.enum(['basic', 'elite']).default('elite'),
});
router.post('/init', auth_1.requireAuth, async (req, res) => {
    try {
        const user = req.user;
        const parsed = InitSchema.safeParse(req.body);
        const plan = parsed.success ? parsed.data.plan : 'elite';
        const amount = PLAN_AMOUNTS[plan] ?? PLAN_AMOUNTS.elite;
        const planLabel = plan === 'basic' ? 'Essential Safety — Yearly' : 'Complete Peace of Mind — Yearly';
        const response = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: user.email,
                amount,
                currency: SUBSCRIPTION_CURRENCY,
                callback_url: CALLBACK_URL,
                metadata: {
                    user_id: user.id,
                    plan,
                    custom_fields: [
                        {
                            display_name: 'Plan',
                            variable_name: 'plan',
                            value: planLabel,
                        },
                    ],
                },
            }),
        });
        const data = await response.json();
        if (!data.status) {
            res.status(400).json({ error: data.message ?? 'Failed to initialize payment' });
            return;
        }
        res.json({
            authorization_url: data.data.authorization_url,
            reference: data.data.reference,
            access_code: data.data.access_code,
        });
    }
    catch (err) {
        console.error('[payments] /init error:', err);
        res.status(500).json({ error: 'Payment initialization failed' });
    }
});
// ── POST /api/v1/payments/verify ──────────────────────────────────────────────
// Verifies a completed Paystack transaction server-side.
// Called after the WebView detects the callback URL redirect.
const VerifySchema = zod_1.z.object({ reference: zod_1.z.string().min(1) });
router.post('/verify', auth_1.requireAuth, async (req, res) => {
    try {
        const user = req.user;
        const parsed = VerifySchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'reference is required' });
            return;
        }
        const { reference } = parsed.data;
        const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } });
        const data = await response.json();
        if (!data.status || data.data.status !== 'success') {
            console.warn('[payments] verify failed:', data.message, data.data?.status);
            res.status(400).json({ error: 'Payment not successful', details: data.message });
            return;
        }
        const plan = planFromAmount(data.data.amount);
        const nextBillingDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        // Activate subscription in Supabase
        const { error: dbError } = await supabase_1.supabaseAdmin
            .from('profiles')
            .upsert({ id: user.id, subscription_status: 'active', plan, next_billing_date: nextBillingDate }, { onConflict: 'id' });
        if (dbError) {
            console.error('[payments] profile update error:', dbError);
            res.status(500).json({ error: 'Payment verified but subscription activation failed' });
            return;
        }
        console.log(`[payments] subscription activated for user ${user.id} — ref ${reference}`);
        res.json({ success: true, subscription_status: 'active' });
    }
    catch (err) {
        console.error('[payments] /verify error:', err);
        res.status(500).json({ error: 'Verification request failed' });
    }
});
// ── POST /api/v1/payments/trial/start ────────────────────────────────────────
// Activates an 8-day free trial. No card required.
router.post('/trial/start', auth_1.requireAuth, async (req, res) => {
    try {
        const user = req.user;
        // Guard: reject if user already had a trial or has an active subscription
        const { data: existing } = await supabase_1.supabaseAdmin
            .from('profiles')
            .select('trial_start, subscription_status')
            .eq('id', user.id)
            .single();
        if (existing) {
            const row = existing;
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
        const { error: dbError } = await supabase_1.supabaseAdmin
            .from('profiles')
            .upsert({
            id: user.id,
            subscription_status: 'trial',
            plan: 'elite',
            trial_start: now.toISOString(),
            trial_end: trialEnd.toISOString(),
        }, { onConflict: 'id' });
        if (dbError) {
            console.error('[trial] profile update error:', dbError);
            res.status(500).json({ error: 'Could not start trial' });
            return;
        }
        console.log(`[trial] 8-day trial started for user ${user.id}, ends ${trialEnd.toISOString()}`);
        res.json({ success: true, trial_end: trialEnd.toISOString() });
    }
    catch (err) {
        console.error('[payments] /trial/start error:', err);
        res.status(500).json({ error: 'Could not start trial' });
    }
});
// ── POST /api/v1/payments/webhook ─────────────────────────────────────────────
// Paystack sends this for every charge event.
// Acts as a safety net: even if the app closes mid-payment, the subscription
// gets activated when Paystack retries the webhook.
// Raw body is required for signature validation — see app.ts for setup.
router.post('/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-paystack-signature'];
        const rawBody = req.rawBody;
        // SEC-02: Signature verification is unconditional — reject if either is missing
        if (!rawBody || !PAYSTACK_SECRET) {
            console.error('[webhook] Missing rawBody or PAYSTACK_SECRET — rejecting');
            res.status(500).json({ error: 'Webhook misconfigured' });
            return;
        }
        const hash = crypto_1.default
            .createHmac('sha512', PAYSTACK_SECRET)
            .update(rawBody)
            .digest('hex');
        if (hash !== signature) {
            res.status(401).json({ error: 'Invalid signature' });
            return;
        }
        const event = req.body;
        if (event.event === 'charge.success') {
            const userId = event.data.metadata?.user_id;
            // SEC-03: Derive plan from verified amount — never trust client metadata
            const plan = planFromAmount(event.data.amount);
            if (userId) {
                // SEC-14: Verify the user exists in auth.users before writing to profiles
                const { data: authUser, error: userLookupErr } = await supabase_1.supabaseAdmin.auth.admin.getUserById(userId);
                if (userLookupErr || !authUser.user) {
                    console.warn(`[webhook] user_id ${userId} not found in auth.users — skipping upsert`);
                    // Return 200 so Paystack doesn't retry — the event is invalid, not a server error
                    res.json({ received: true });
                    return;
                }
                const nextBillingDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
                const { error: whErr } = await supabase_1.supabaseAdmin
                    .from('profiles')
                    .upsert({ id: userId, subscription_status: 'active', plan, next_billing_date: nextBillingDate }, { onConflict: 'id' });
                if (whErr) {
                    console.error('[webhook] profile update error:', whErr);
                }
                else {
                    console.log(`[webhook] subscription activated via webhook for user ${userId} plan=${plan}`);
                }
            }
        }
        res.json({ received: true });
    }
    catch (err) {
        console.error('[payments] /webhook error:', err);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});
exports.default = router;

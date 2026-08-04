"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const supabase_1 = require("../lib/supabase");
const africastalking_1 = require("../services/africastalking");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ── POST /api/v1/trips/notify-start ──────────────────────────────────────────
const NotifyStartSchema = zod_1.z.object({
    tripId: zod_1.z.string().uuid(),
    origin: zod_1.z.string().min(2),
    destination: zod_1.z.string().min(2),
    contactIds: zod_1.z.array(zod_1.z.string().uuid()).min(1),
});
router.post('/notify-start', auth_1.requireAuth, async (req, res) => {
    const parsed = NotifyStartSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: parsed.error.issues[0]?.message ?? 'Invalid request',
            code: 'VALIDATION_ERROR',
        });
        return;
    }
    const { origin, destination, contactIds } = parsed.data;
    const userId = req.user.id;
    // Fetch contacts — only ones belonging to this user (RLS-equivalent check)
    const { data: contacts, error: contactsError } = await supabase_1.supabase
        .from('trusted_contacts')
        .select('id, name, phone, notify_on_trip_start')
        .eq('user_id', userId)
        .in('id', contactIds);
    if (contactsError) {
        res.status(500).json({ error: contactsError.message, code: 'DB_ERROR' });
        return;
    }
    // Fetch user's display name from profiles
    const { data: profile } = await supabase_1.supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .single();
    const userName = profile?.full_name ?? 'Someone';
    // Truncate origin/destination to keep SMS under 160 chars
    const from_ = origin.length > 20 ? `${origin.slice(0, 17)}…` : origin;
    const to_ = destination.length > 20 ? `${destination.slice(0, 17)}…` : destination;
    const rows = (contacts ?? []);
    // Send concurrently — one failure doesn't block the rest
    const results = await Promise.allSettled(rows.map(async (contact) => {
        const message = `Hi ${contact.name}, ${userName} has started a trip from ${from_} to ${to_} and is sharing their live location with you. Powered by Hadin.`;
        const result = await (0, africastalking_1.sendSMS)(contact.phone, message);
        if (!result.success) {
            console.warn(`[trips/notify-start] SMS failed for ${contact.name}:`, result.error);
        }
        return result;
    }));
    const notified = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    res.status(200).json({ success: true, notified });
});
// Preserve existing stub routes
router.post('/', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
router.get('/', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
router.get('/:id', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
router.patch('/:id', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
router.delete('/:id', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
exports.default = router;

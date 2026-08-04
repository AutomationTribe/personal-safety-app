"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const africastalking_1 = require("../services/africastalking");
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const router = (0, express_1.Router)();
// ── POST /api/v1/contacts/notify ─────────────────────────────────────────────
const NotifySchema = zod_1.z.object({
    contactPhone: zod_1.z.string().regex(/^\+234[789]\d{9}$/, 'Must be a Nigerian E.164 number'),
    contactName: zod_1.z.string().min(1),
    userName: zod_1.z.string().min(1),
});
router.post('/notify', auth_1.requireAuth, rateLimit_1.notifyRateLimit, async (req, res) => {
    const parsed = NotifySchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            error: parsed.error.issues[0]?.message ?? 'Invalid request',
            code: 'VALIDATION_ERROR',
        });
        return;
    }
    const { contactPhone, contactName, userName } = parsed.data;
    const userId = req.user.id;
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[contacts/notify] user=${userId} → ${contactPhone}`);
    }
    const message = `Hi ${contactName}, ${userName} added you to their Hadin safety circle. You'll be notified if they need help while travelling. hellohadin.netlify.app`;
    const result = await (0, africastalking_1.sendSMS)(contactPhone, message);
    if (!result.success) {
        res.status(500).json({ error: result.error ?? 'SMS failed', code: 'SMS_FAILED' });
        return;
    }
    res.json({ success: true, messageId: result.messageId });
});
// ── Stub routes (to be built) ─────────────────────────────────────────────────
router.get('/', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
router.post('/', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
router.delete('/:id', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
exports.default = router;

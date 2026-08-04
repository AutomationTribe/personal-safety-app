"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const africastalking_1 = require("../services/africastalking");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const E164_REGEX = /^\+234[789]\d{9}$/;
function toE164(raw) {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('234') && digits.length === 13)
        return `+${digits}`;
    if (digits.startsWith('0') && digits.length === 11)
        return `+234${digits.slice(1)}`;
    if (digits.length === 10)
        return `+234${digits}`;
    return `+${digits}`;
}
// ── POST /api/v1/auth/welcome-sms ────────────────────────────────────────────
// Sends a welcome SMS to the newly registered user's phone number.
// Called once by mobile immediately after signUp() succeeds.
// Non-critical: AT failure returns 200 with success=false rather than 5xx.
router.post('/welcome-sms', auth_1.requireAuth, async (req, res) => {
    const user = req.user;
    const rawPhone = user.user_metadata?.phone ?? '';
    if (!rawPhone) {
        res.status(400).json({ error: 'No phone number on account', code: 'PHONE_MISSING' });
        return;
    }
    const phone = toE164(rawPhone);
    if (!E164_REGEX.test(phone)) {
        res.status(400).json({ error: 'Phone number is not a valid Nigerian number', code: 'INVALID_PHONE' });
        return;
    }
    const message = 'Welcome to Hadin! Your account is ready. Stay protected on every journey. hellohadin.netlify.app';
    const result = await (0, africastalking_1.sendSMS)(phone, message);
    if (!result.success) {
        console.warn('[auth/welcome-sms] SMS delivery failed for user', user.id, '—', result.error);
        res.json({ success: false, error: result.error });
        return;
    }
    console.log('[auth/welcome-sms] Welcome SMS sent for user', user.id);
    res.json({ success: true, messageId: result.messageId });
});
exports.default = router;

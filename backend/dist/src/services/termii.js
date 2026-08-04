"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSMS = sendSMS;
const TERMII_URL = 'https://v3.api.termii.com/api/sms/send';
async function sendSMS(to, message) {
    try {
        const res = await fetch(TERMII_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to,
                from: 'Termii',
                sms: message,
                type: 'plain',
                channel: 'generic',
                api_key: process.env.TERMII_API_KEY,
            }),
        });
        const data = (await res.json());
        if (!res.ok && !data.message_id) {
            const errMsg = Array.isArray(data.error)
                ? data.error.map((e) => `${e.field}: ${e.issue}`).join(', ')
                : (data.error ?? data.message ?? `HTTP ${res.status}`);
            console.warn(`[SMS] Termii delivery issue to ${to}:`, errMsg);
            return { success: false, error: errMsg };
        }
        if (data.message === 'Successfully Sent' || data.message_id) {
            console.log(`[SMS] Termii sent to ${to} | id: ${data.message_id ?? 'n/a'}`);
            return { success: true, messageId: data.message_id };
        }
        const errMsg = data.message ?? 'Unknown Termii response';
        console.warn(`[SMS] Termii unexpected response for ${to}:`, JSON.stringify(data));
        return { success: false, error: errMsg };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown Termii error';
        console.error(`[SMS] Termii request failed for ${to}:`, msg);
        return { success: false, error: msg };
    }
}

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSMS = sendSMS;
const dotenv = __importStar(require("dotenv"));
dotenv.config();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AfricasTalking = require('africastalking');
const isDev = process.env.NODE_ENV !== 'production';
const at = AfricasTalking({
    apiKey: process.env.AT_API_KEY ?? '',
    username: isDev ? 'sandbox' : (process.env.AT_USERNAME ?? ''),
});
const sms = at.SMS;
async function sendSMS(to, message) {
    try {
        const result = await sms.send({
            to: [to],
            message,
        });
        const recipient = result?.SMSMessageData?.Recipients?.[0];
        const status = recipient?.status ?? '';
        const code = recipient?.statusCode ?? 0;
        console.log(`[SMS] AT response for ${to}:`, JSON.stringify(result?.SMSMessageData));
        if (code === 101 || status === 'Success') {
            console.log(`[SMS] Sent to ${to} | status: ${status}`);
            return { success: true };
        }
        console.warn(`[SMS] Delivery issue to ${to} | status: ${status} | code: ${code}`);
        return { success: false, error: `AT status: ${status} (code: ${code})` };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown AT error';
        console.error(`[SMS] Failed to send to ${to}:`, msg);
        return { success: false, error: msg };
    }
}

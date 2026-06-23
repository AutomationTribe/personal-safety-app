import * as dotenv from 'dotenv';

dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AfricasTalking = require('africastalking');

const isDev = process.env.NODE_ENV !== 'production';

const at = AfricasTalking({
  apiKey: process.env.AT_API_KEY ?? '',
  username: isDev ? 'sandbox' : (process.env.AT_USERNAME ?? ''),
});

const sms = at.SMS;
// Sandbox does not support custom sender IDs — use undefined to let AT pick the default
const SENDER_ID = isDev ? undefined : (process.env.AT_SENDER_ID ?? 'HADIN');

export interface SMSResult {
  success: boolean;
  error?: string;
}

export async function sendSMS(to: string, message: string): Promise<SMSResult> {
  try {
    const result = await sms.send({
      to: [to],
      message,
      ...(SENDER_ID ? { from: SENDER_ID } : {}),
    }) as { SMSMessageData?: { Recipients?: Array<{ status: string; statusCode: number }> } };

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
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown AT error';
    console.error(`[SMS] Failed to send to ${to}:`, msg);
    return { success: false, error: msg };
  }
}

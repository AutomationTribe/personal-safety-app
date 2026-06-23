import AfricasTalking from 'africastalking';

const isDev = process.env.NODE_ENV !== 'production';

// Sandbox username in dev, live AT_USERNAME in prod. NEVER expose to mobile.
const at = AfricasTalking({
  username: isDev ? 'sandbox' : (process.env.AT_USERNAME ?? ''),
  apiKey: process.env.AT_API_KEY ?? '',
});

export const sms = at.SMS;
export const SENDER_ID = process.env.AT_SENDER_ID ?? 'HADIN';

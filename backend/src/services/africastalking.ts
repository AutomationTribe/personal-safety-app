export async function sendSMS(
  to: string,
  message: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const apiKey = process.env.AT_API_KEY ?? '';
  const username = process.env.AT_USERNAME ?? '';

  const body = new URLSearchParams();
  body.append('username', username);
  body.append('to', to);
  body.append('message', message);

  console.log('[AT] Sending SMS to', to.slice(0, 8) + '****');
  console.log('[AT] Username:', username);
  console.log('[AT] Key prefix:', apiKey.slice(0, 10));

  try {
    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'apiKey': apiKey,
      },
      body: body.toString(),
    });

    const data = await res.json() as {
      SMSMessageData: {
        Message: string;
        Recipients: Array<{
          statusCode: number;
          status: string;
          messageId: string;
        }>;
      };
    };

    console.log('[AT] Full response:', JSON.stringify(data));

    const recipient = data.SMSMessageData?.Recipients?.[0];

    if (!recipient || recipient.statusCode !== 100) {
      const errMsg = recipient?.status ?? data.SMSMessageData?.Message ?? 'Unknown error';
      console.warn('[AT] Delivery failed:', errMsg);
      return { success: false, error: errMsg };
    }

    console.log('[AT] Success | messageId:', recipient.messageId);
    return { success: true, messageId: recipient.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'fetch error';
    console.error('[AT] Request error:', msg);
    return { success: false, error: msg };
  }
}

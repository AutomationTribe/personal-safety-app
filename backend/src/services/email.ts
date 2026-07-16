// Direct fetch to Resend's API — no SDK, mirroring the Africa's Talking
// service pattern. Gracefully no-ops (logs + returns success:false) when
// RESEND_API_KEY isn't configured, so email is best-effort and never blocks
// the SOS/SMS path it rides alongside.

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY ?? '';
  const from = process.env.EMAIL_FROM ?? 'Hadin Safety <alerts@hadin.app>';

  if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY not set — skipping email to', to);
    return { success: false, error: 'Email not configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[Email] Send failed:', res.status, body);
      return { success: false, error: `HTTP ${res.status}` };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'fetch error';
    console.error('[Email] Request error:', msg);
    return { success: false, error: msg };
  }
}

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { sendSMS } from '../services/africastalking';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

const SOSSchema = z.object({
  tripId: z.string().uuid(),
  lat: z.number(),
  lng: z.number(),
  timestamp: z.string(),
});

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-NG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Africa/Lagos',
    });
  } catch {
    return iso;
  }
}

// ── POST /api/v1/sos ─────────────────────────────────────────────────────────

router.post(
  '/',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SOSSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid request',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const { tripId, lat, lng, timestamp } = parsed.data;
    const userId = (req as AuthRequest).user.id;

    // Rate limit: max 5 per user per 10 min — always return 200, just log
    const windowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from('sos_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('triggered_at', windowStart);

    if ((recentCount ?? 0) >= 5) {
      console.log(`[SOS] Rate limit hit — user=${userId}`);
      res.json({ success: true, rateLimited: true, notified: 0, total: 0 });
      return;
    }

    // 1. Verify trip belongs to this user; fetch contact_ids from trip
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, contact_ids')
      .eq('id', tripId)
      .eq('user_id', userId)
      .single();

    if (tripError || !trip) {
      res.status(404).json({ error: 'Trip not found', code: 'NOT_FOUND' });
      return;
    }

    // 2. Fetch contact details using contact_ids stored on the trip
    const contactIds = ((trip as { id: string; contact_ids: string[] | null }).contact_ids) ?? [];

    const { data: contactRows } = contactIds.length > 0
      ? await supabase
          .from('trusted_contacts')
          .select('name, phone')
          .in('id', contactIds)
          .eq('user_id', userId)
      : { data: [] as Array<{ name: string; phone: string }> };

    const contacts = (contactRows ?? []) as Array<{ name: string; phone: string }>;
    const total = contacts.length;

    // 3. Get user display name from profiles; fall back to auth email
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .single();

    const rawName: string =
      ((profile as { full_name: string | null } | null)?.full_name) ??
      (req as AuthRequest).user.email ??
      'A Hadin user';
    const userName = rawName.slice(0, 20);

    // 4. Write sos_event immediately — always, even if SMS subsequently fails
    const { data: sosEvent, error: insertError } = await supabase
      .from('sos_events')
      .insert({
        trip_id: tripId,
        user_id: userId,
        triggered_at: timestamp,
        delivery_method: 'sms',
        contacts_total: total,
        contacts_notified: 0,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[SOS] sos_event insert failed:', insertError.message);
    }

    const sosEventId = (sosEvent as { id: string } | null)?.id;
    console.log(`[SOS] Event created id=${sosEventId ?? 'none'} user=${userId} trip=${tripId} contacts=${total}`);

    // 5. Build SMS — max 160 chars
    const time = formatTime(timestamp);
    const message = `ALERT: ${userName} needs your assistance. Last known location as at ${time}: ${lat}, ${lng}`;
    console.log(`[SOS] Message (${message.length} chars):`, message);

    // 6. Send to all contacts — Promise.allSettled so one failure never blocks others
    let notified = 0;
    if (total > 0) {
      const results = await Promise.allSettled(
        contacts.map(({ phone }) =>
          sendSMS(phone, message).then((r) => {
            if (r.success) {
              console.log(`[SOS] SMS sent → ${phone} | id: ${r.messageId}`);
              return true;
            }
            console.warn(`[SOS] SMS failed → ${phone}: ${r.error ?? 'unknown'}`);
            return false;
          }),
        ),
      );

      notified = results.filter(
        (r) => r.status === 'fulfilled' && r.value === true,
      ).length;
    }

    // 7. Update sos_event with actual notified count
    if (sosEventId) {
      await supabase
        .from('sos_events')
        .update({ contacts_notified: notified })
        .eq('id', sosEventId);
    }

    // 8. Update trip status to sos
    await supabase
      .from('trips')
      .update({ status: 'sos' })
      .eq('id', tripId)
      .eq('user_id', userId);

    console.log(`[SOS] Done: notified=${notified}/${total} event=${sosEventId ?? 'none'}`);

    // Always 200 — SMS delivery failure is never a server error
    res.json({ success: true, sosEventId, notified, total });
  },
);

// ── PATCH /api/v1/sos/:id/cancel ─────────────────────────────────────────────

router.patch(
  '/:id/cancel',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const userId = (req as AuthRequest).user.id;

    const { data, error } = await supabase
      .from('sos_events')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .is('cancelled_at', null)
      .select('id')
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'SOS event not found', code: 'NOT_FOUND' });
      return;
    }

    console.log(`[SOS] Cancelled event=${id} user=${userId}`);
    res.json({ success: true });
  },
);

export default router;

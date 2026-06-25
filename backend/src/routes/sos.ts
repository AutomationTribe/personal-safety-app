import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { sendSMS } from '../services/africastalking';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { sosRateLimit } from '../middleware/rateLimit';

const router = Router();

const SOSSchema = z.object({
  tripId: z.string().uuid(),
  lat: z.number(),
  lng: z.number(),
  contactIds: z.array(z.string().uuid()).min(1),
});

type ATResponse = {
  SMSMessageData: {
    Recipients: Array<{ statusCode: number; status: string; messageId: string }>;
  };
};

// ── POST /api/v1/sos ─────────────────────────────────────────────────────────

router.post(
  '/',
  requireAuth,
  sosRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SOSSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid request',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const { tripId, lat, lng, contactIds } = parsed.data;
    const userId = (req as AuthRequest).user.id;
    const userName =
      ((req as AuthRequest).user.user_metadata?.['name'] as string | undefined) ??
      'A Hadin user';

    // 1. Verify trip belongs to this user
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id')
      .eq('id', tripId)
      .eq('user_id', userId)
      .single();

    if (tripError || !trip) {
      res.status(404).json({ error: 'Trip not found', code: 'NOT_FOUND' });
      return;
    }

    // 2. Insert SOS event — log regardless of outcome, never throw
    let eventId: string | undefined;
    try {
      const { data: event, error: insertError } = await supabase
        .from('sos_events')
        .insert({
          user_id: userId,
          trip_id: tripId,
          // PostGIS WKT — POINT(lng lat) note: longitude first
          coords: `POINT(${lng} ${lat})`,
          triggered_at: new Date().toISOString(),
          delivery_method: 'internet',
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[SOS] Insert failed:', insertError.message);
      } else {
        eventId = event?.id as string | undefined;
        // Update trip status to sos — non-blocking
        await supabase
          .from('trips')
          .update({ status: 'sos' })
          .eq('id', tripId)
          .eq('user_id', userId);
      }
    } catch (err) {
      console.error('[SOS] Unexpected insert error:', err);
    }

    console.log(
      `[SOS] Triggered user=${userId} trip=${tripId} lat=${lat} lng=${lng} event=${eventId ?? 'no-id'}`,
    );

    // 3. Fetch contact phones (only this user's contacts, only sos-enabled)
    const { data: contacts } = await supabase
      .from('trusted_contacts')
      .select('phone')
      .in('id', contactIds)
      .eq('user_id', userId)
      .eq('notify_on_sos', true);

    const phones = (contacts ?? []).map((c) => c.phone as string);
    const total = phones.length;

    // 4. SMS all contacts in parallel — never await serially, never block response
    const message = `\u{1F6A8} SOS from ${userName}: I need help. My last location: https://maps.google.com/?q=${lat},${lng} — Hadin Safety App`;

    let notified = 0;
    if (total > 0) {
      const results = await Promise.allSettled(
        phones.map((phone) =>
          sendSMS(phone, message).then((r) => {
            if (r.success) {
              console.log(`[SOS] SMS sent → ${phone} | id: ${r.messageId}`);
              return true;
            }
            console.warn(`[SOS] AT issue → ${phone}: ${r.error ?? 'unknown'}`);
            return false;
          }),
        ),
      );

      notified = results.filter(
        (r) => r.status === 'fulfilled' && r.value === true,
      ).length;
    }

    console.log(`[SOS] Result: notified=${notified}/${total} event=${eventId ?? 'none'}`);

    // Always 200 — SMS failure is not a server error
    res.json({ success: true, eventId, notified, total });
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

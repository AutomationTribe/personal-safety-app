import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { sendSMS } from '../services/africastalking';
import { sendEmail } from '../services/email';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

const SOSSchema = z.object({
  // Optional — SOS can be triggered from the idle dashboard with no active
  // trip (flows/mobile/sos-manual.md).
  tripId: z.string().uuid().nullable().optional(),
  lat: z.number(),
  lng: z.number(),
  timestamp: z.string(),
  // 1 = circle + monitoring center (default, unchanged behaviour).
  // 2 = monitoring center only — fired automatically by the mobile
  // stop-detector after 60s of no response; must never SMS the circle.
  alertLevel: z.number().int().min(1).max(2).optional().default(1),
  // Device snapshot at trigger time — best-effort, null if the device
  // couldn't read them (e.g. expo-battery unavailable). Purely informational
  // for the SOS detail screen, never affects delivery.
  batteryLevel: z.number().int().min(0).max(100).nullable().optional(),
  networkType: z.string().nullable().optional(),
});

// 60s after a level-1 SOS is created, escalate it to level-2 (monitoring
// center only) if it's still active — i.e. the user never confirmed safe
// and it was never cancelled/resolved. This is a plain in-process timer
// (per the flow spec) rather than a durable job: it does NOT survive a
// backend restart/redeploy within that 60s window. Acceptable for a single
// Railway instance at current scale — see flows/backend/sos-manual.md.
async function escalateIfStillActive(sosEventId: string): Promise<void> {
  const { data, error } = await supabase
    .from('sos_events')
    .select('id, alert_level, cancelled_at, resolved_at')
    .eq('id', sosEventId)
    .single();

  if (error || !data) return;
  const row = data as { id: string; alert_level: number; cancelled_at: string | null; resolved_at: string | null };
  if (row.cancelled_at || row.resolved_at || row.alert_level >= 2) return;

  await supabase
    .from('sos_events')
    .update({ alert_level: 2 })
    .eq('id', sosEventId);

  // Realtime is already enabled on sos_events (see migration 005), so the
  // monitoring dashboard's postgres_changes subscription picks up this
  // UPDATE automatically — no separate "notify" call needed.
  console.log(`[SOS] Escalated to level-2 (no response in 60s) event=${sosEventId}`);
}

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

    const { tripId, lat, lng, timestamp, alertLevel, batteryLevel, networkType } = parsed.data;
    const userId = (req as AuthRequest).user.id;
    const coords = `POINT(${lng} ${lat})`;

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

    // 1. If a trip was given, verify it belongs to this user. No trip is
    // valid too — a manual SOS from the idle dashboard has none.
    let trip: { id: string; contact_ids: string[] | null } | null = null;
    if (tripId) {
      const { data, error: tripError } = await supabase
        .from('trips')
        .select('id, contact_ids')
        .eq('id', tripId)
        .eq('user_id', userId)
        .single();

      if (tripError || !data) {
        res.status(404).json({ error: 'Trip not found', code: 'NOT_FOUND' });
        return;
      }
      trip = data as { id: string; contact_ids: string[] | null };
    }

    // 2nd-level alert: monitoring-center-only, silent. Skip the contacts
    // fetch and SMS loop entirely, and never flip the trip to 'sos' — this
    // is an internal check-in, not a circle-facing emergency.
    if (alertLevel === 2) {
      const { data: sosEvent, error: insertError } = await supabase
        .from('sos_events')
        .insert({
          trip_id: tripId,
          user_id: userId,
          coords,
          triggered_at: timestamp,
          delivery_method: 'internet',
          alert_level: 2,
          // Level-2 only fires from the mobile stop-detector's silent
          // "are you okay" no-response check-in — always trip-originated,
          // never a manual button press.
          trigger_type: 'trip_auto',
          contacts_total: 0,
          contacts_notified: 0,
          battery_level: batteryLevel ?? null,
          network_type: networkType ?? null,
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('[SOS] level-2 sos_event insert failed:', insertError.message);
      }

      const eventId = (sosEvent as { id: string } | null)?.id;
      console.log(`[SOS] Level-2 (silent) event created id=${eventId ?? 'none'} user=${userId} trip=${tripId}`);
      res.json({ success: true, eventId, notified: 0, total: 0 });
      return;
    }

    // 2. Fetch contact details — from the trip's contact_ids if this SOS is
    // tied to a trip, otherwise every circle contact opted into SOS alerts.
    const contactIds = trip?.contact_ids ?? [];

    const { data: contactRows } = trip
      ? (contactIds.length > 0
          ? await supabase
              .from('trusted_contacts')
              .select('id, name, phone, email')
              .in('id', contactIds)
              .eq('user_id', userId)
          : { data: [] as Array<{ id: string; name: string; phone: string; email: string | null }> })
      : await supabase
          .from('trusted_contacts')
          .select('id, name, phone, email')
          .eq('user_id', userId)
          .eq('notify_on_sos', true);

    const contacts = (contactRows ?? []) as Array<{ id: string; name: string; phone: string; email: string | null }>;
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
        coords,
        triggered_at: timestamp,
        delivery_method: 'both',
        alert_level: 1,
        trigger_type: 'manual',
        contacts_total: total,
        contacts_notified: 0,
        notified_contact_ids: contacts.map((c) => c.id),
        battery_level: batteryLevel ?? null,
        network_type: networkType ?? null,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[SOS] sos_event insert failed:', insertError.message);
    }

    const eventId = (sosEvent as { id: string } | null)?.id;
    console.log(`[SOS] Event created id=${eventId ?? 'none'} user=${userId} trip=${tripId} contacts=${total}`);

    // 60s no-response auto-escalation to level-2 (monitoring center only).
    if (eventId) {
      setTimeout(() => {
        void escalateIfStillActive(eventId);
      }, 60_000);
    }

    // 5. Build SMS + email body
    const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
    const message = `SOS alert from ${userName}. His last know location is ${lat}, ${lng} (${mapsUrl}) - Hadin (https://hadin.app)`;
    console.log(`[SOS] Message (${message.length} chars):`, message);

    // 6. Send SMS + email to all contacts — Promise.allSettled so one
    // failure (or one channel) never blocks the others. `notified` tracks
    // SMS delivery specifically, matching the mobile UI's existing
    // "Contacts reached: X of Y" contract; email is best-effort on top.
    let notified = 0;
    if (total > 0) {
      const results = await Promise.allSettled(
        contacts.map(async ({ phone, email }) => {
          const smsResult = await sendSMS(phone, message);
          if (smsResult.success) {
            console.log(`[SOS] SMS sent → ${phone} | id: ${smsResult.messageId}`);
          } else {
            console.warn(`[SOS] SMS failed → ${phone}: ${smsResult.error ?? 'unknown'}`);
          }

          if (email) {
            const emailResult = await sendEmail(email, 'SOS Alert — Hadin Safety', message);
            if (!emailResult.success) {
              console.warn(`[SOS] Email failed → ${email}: ${emailResult.error ?? 'unknown'}`);
            }
          }

          return smsResult.success;
        }),
      );

      notified = results.filter(
        (r) => r.status === 'fulfilled' && r.value === true,
      ).length;
    }

    // 7. Update sos_event with actual notified count
    if (eventId) {
      await supabase
        .from('sos_events')
        .update({ contacts_notified: notified })
        .eq('id', eventId);
    }

    // 8. Update trip status to sos — only when this SOS is tied to a trip
    if (tripId) {
      await supabase
        .from('trips')
        .update({ status: 'sos' })
        .eq('id', tripId)
        .eq('user_id', userId);
    }

    console.log(`[SOS] Done: notified=${notified}/${total} event=${eventId ?? 'none'}`);

    // Always 200 — SMS delivery failure is never a server error
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

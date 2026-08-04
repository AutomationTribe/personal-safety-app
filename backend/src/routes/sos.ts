import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { sendSMS } from '../services/africastalking';
import { sendEmail } from '../services/email';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { sosRateLimit } from '../middleware/rateLimit';
import rateLimit from 'express-rate-limit';

const router = Router();

// Public base URL for the acknowledgement link sent in SOS SMS/email — see
// flows/backend/sos-manual.md "Blocked" for the DNS/deploy caveat.
const ACK_BASE_URL = 'https://api.hadin.app';

const SOSSchema = z.object({
  // Optional — SOS can be triggered from the idle dashboard with no active
  // trip (flows/mobile/sos-manual.md).
  tripId: z.string().uuid().nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
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

    const { tripId, lat, lng, timestamp, alertLevel, batteryLevel, networkType } = parsed.data;
    const userId = (req as AuthRequest).user.id;
    const coords = `POINT(${lng} ${lat})`;

    // ── Phase 1: parallel independent reads ──────────────────────────────────
    const windowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const [rateResult, tripResult, profileResult] = await Promise.all([
      // 1a. Rate check
      supabase
        .from('sos_events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('triggered_at', windowStart),

      // 1b. Trip lookup (only if tripId was supplied)
      tripId
        ? supabase
            .from('trips')
            .select('id, contact_ids')
            .eq('id', tripId)
            .eq('user_id', userId)
            .single()
        : Promise.resolve({ data: null, error: null, count: null }),

      // 1c. User profile (for display name in SMS)
      supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .single(),
    ]);

    // Rate limit check
    const { count: recentCount } = rateResult;
    if ((recentCount ?? 0) >= 3) {
      console.log(`[SOS] Rate limit hit — user=${userId}`);
      res.json({ success: true, rateLimited: true, notified: 0, total: 0 });
      return;
    }

    // Trip existence check
    let trip: { id: string; contact_ids: string[] | null } | null = null;
    if (tripId) {
      const { data: tripData, error: tripError } = tripResult;
      if (tripError || !tripData) {
        res.status(404).json({ error: 'Trip not found', code: 'NOT_FOUND' });
        return;
      }
      trip = tripData as { id: string; contact_ids: string[] | null };
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

    // 3. Get user display name from Phase 1 profile result; fall back to auth email
    const rawName: string =
      ((profileResult.data as { full_name: string | null } | null)?.full_name) ??
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

    // 4b. Create a sos_notifications row per contact — tracks individual
    // acknowledgement status (Acknowledged / Notified / Failed in
    // SOSDetailScreen), each with its own acknowledgement_token used to
    // build a personalized ack link per recipient below.
    const notificationTokenByContactId = new Map<string, string>();
    if (eventId && total > 0) {
      const { data: matchingProfiles } = await supabase
        .from('profiles')
        .select('phone')
        .in('phone', contacts.map((c) => c.phone));
      const platformPhones = new Set(
        ((matchingProfiles ?? []) as Array<{ phone: string | null }>)
          .map((p) => p.phone)
          .filter((p): p is string => !!p),
      );

      const { data: notifRows, error: notifError } = await supabase
        .from('sos_notifications')
        .insert(
          contacts.map((c) => ({
            sos_event_id: eventId,
            contact_id: c.id,
            contact_name: c.name,
            contact_phone: c.phone,
            is_platform_user: platformPhones.has(c.phone),
          })),
        )
        .select('contact_id, acknowledgement_token');

      if (notifError) {
        console.error('[SOS] sos_notifications insert failed:', notifError.message);
      }
      ((notifRows ?? []) as Array<{ contact_id: string; acknowledgement_token: string }>).forEach((n) => {
        notificationTokenByContactId.set(n.contact_id, n.acknowledgement_token);
      });
    }

    // 5. Build SMS + email body
    const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
    const baseMessage = `SOS alert from ${userName}. Their last known location is ${lat}, ${lng} (${mapsUrl}) - Hadin (https://hadin.app)`;

    // 6. Send SMS + email to all contacts — Promise.allSettled so one
    // failure (or one channel) never blocks the others. `notified` tracks
    // SMS delivery specifically, matching the mobile UI's existing
    // "Contacts reached: X of Y" contract; email is best-effort on top.
    // Every contact's message includes their own acknowledgement link —
    // FCM push infra isn't wired up yet (see flows/backend/sos-manual.md),
    // so this SMS link is the only acknowledgement path for platform and
    // non-platform contacts alike for now.
    let notified = 0;
    if (total > 0) {
      const results = await Promise.allSettled(
        contacts.map(async ({ id, phone, email }) => {
          const token = notificationTokenByContactId.get(id);
          const message = token
            ? `${baseMessage}. Tap to acknowledge: ${ACK_BASE_URL}/api/v1/sos/ack/${token}`
            : baseMessage;

          const smsResult = await sendSMS(phone, message);
          if (smsResult.success) {
            console.log(`[SOS] SMS sent → ${phone} | id: ${smsResult.messageId}`);
          } else {
            console.warn(`[SOS] SMS failed → ${phone}: ${smsResult.error ?? 'unknown'}`);
            if (token) {
              await supabase
                .from('sos_notifications')
                .update({ delivery_status: 'failed' })
                .eq('acknowledgement_token', token);
            }
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

// ── GET /api/v1/sos/ack/:token ───────────────────────────────────────────────
// Public — no auth. Reached by tapping the acknowledgement link in the SOS
// SMS/email. The circle member is never logged in, so this must work
// without a Bearer token; it's the only ack path today (see the "FCM not
// wired up" note in flows/backend/sos-manual.md).

function ackHtml(title: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hadin Safety</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F4F3EF;color:#1A1A1A;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
  .card{background:#fff;border-radius:16px;padding:32px 24px;max-width:360px;box-shadow:0 2px 12px rgba(0,0,0,0.08)}
  h1{font-size:20px;margin:0 0 12px}
  p{font-size:14px;line-height:1.5;color:#6B6A73;margin:0}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

// SEC-07: IP-based rate limit for the public ack endpoint — 20 taps per minute per IP
const ackRateLimit = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 20,                   // 20 ack taps per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).type('html').send(
      ackHtml('Too many requests', 'Please wait a moment before trying again.'),
    );
  },
});

router.get(
  '/ack/:token',
  ackRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    const { token } = req.params;

    const { data: notif } = await supabase
      .from('sos_notifications')
      .select('id, sos_event_id, acknowledged_at')
      .eq('acknowledgement_token', token)
      .single();

    if (!notif) {
      res.status(404).type('html').send(
        ackHtml('Link not found', 'This acknowledgement link is invalid or has expired.'),
      );
      return;
    }

    const row = notif as { id: string; sos_event_id: string; acknowledged_at: string | null };

    const { data: sosEvent } = await supabase
      .from('sos_events')
      .select('user_id')
      .eq('id', row.sos_event_id)
      .single();

    let firstName = 'them';
    if (sosEvent) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', (sosEvent as { user_id: string }).user_id)
        .single();
      const fullName = (profile as { full_name: string | null } | null)?.full_name;
      if (fullName) firstName = fullName.split(' ')[0];
    }

    // Idempotent — tapping the link again just re-shows the confirmation,
    // acknowledged_at is only ever set once.
    if (!row.acknowledged_at) {
      await supabase
        .from('sos_notifications')
        .update({ acknowledged_at: new Date().toISOString(), delivery_status: 'acknowledged' })
        .eq('id', row.id);
      console.log(`[SOS] Notification acknowledged id=${row.id} event=${row.sos_event_id}`);
    }

    res.status(200).type('html').send(
      ackHtml('✓ Acknowledged', `You have confirmed you received this SOS alert from Hadin Safety. Please check on ${firstName} immediately.`),
    );
  },
);

// ── POST /api/v1/sos/ack/platform ────────────────────────────────────────────
// Authenticated — for a circle member who also has a Hadin account (their
// contact phone matches their own profile.phone) to acknowledge from inside
// the app. Built per spec; not currently reachable from any mobile screen —
// there's no push notification (FCM isn't wired up, see flows doc) or
// "alerts sent to me" inbox to tap into it from yet. The universal SMS ack
// link above works for platform and non-platform contacts alike today.

const AckPlatformSchema = z.object({
  sos_event_id: z.string().uuid(),
});

router.post(
  '/ack/platform',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = AckPlatformSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid request',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const userId = (req as AuthRequest).user.id;
    const { data: profile } = await supabase
      .from('profiles')
      .select('phone')
      .eq('id', userId)
      .single();
    const myPhone = (profile as { phone: string | null } | null)?.phone;

    if (!myPhone) {
      res.status(404).json({ error: 'No phone on file for this account', code: 'NOT_FOUND' });
      return;
    }

    const { data, error } = await supabase
      .from('sos_notifications')
      .update({ acknowledged_at: new Date().toISOString(), delivery_status: 'acknowledged' })
      .eq('sos_event_id', parsed.data.sos_event_id)
      .eq('contact_phone', myPhone)
      .select('id')
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Notification not found', code: 'NOT_FOUND' });
      return;
    }

    console.log(`[SOS] Platform ack event=${parsed.data.sos_event_id} user=${userId}`);
    res.json({ success: true });
  },
);

export default router;

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { sendSMS } from '../services/notificationService';

const router = Router();

// ── Auth middleware ────────────────────────────────────────────────────────────

async function requireAuth(req: Request, res: Response, next: () => void): Promise<void> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    return;
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    return;
  }

  (req as Request & { user: typeof user }).user = user;
  next();
}

// ── POST /api/v1/trips/notify-start ──────────────────────────────────────────

const NotifyStartSchema = z.object({
  tripId: z.string().uuid(),
  origin: z.string().min(2),
  destination: z.string().min(2),
  contactIds: z.array(z.string().uuid()).min(1),
});

router.post(
  '/notify-start',
  (req: Request, res: Response, next: () => void) => { requireAuth(req, res, next); },
  async (req: Request, res: Response): Promise<void> => {
    const authedReq = req as Request & { user: { id: string } };

    const parsed = NotifyStartSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid request',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const { origin, destination, contactIds } = parsed.data;
    const userId = authedReq.user.id;

    // Fetch contacts — only ones belonging to this user (RLS-equivalent check)
    const { data: contacts, error: contactsError } = await supabase
      .from('trusted_contacts')
      .select('id, name, phone, notify_on_trip_start')
      .eq('user_id', userId)
      .in('id', contactIds);

    if (contactsError) {
      res.status(500).json({ error: contactsError.message, code: 'DB_ERROR' });
      return;
    }

    // Fetch user's display name from profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .single();

    const userName = (profile as { full_name?: string } | null)?.full_name ?? 'Someone';

    // Truncate origin/destination to keep SMS under 160 chars
    const from_ = origin.length > 20 ? `${origin.slice(0, 17)}…` : origin;
    const to_ = destination.length > 20 ? `${destination.slice(0, 17)}…` : destination;

    const rows = (contacts ?? []) as Array<{
      id: string;
      name: string;
      phone: string;
      notify_on_trip_start: boolean;
    }>;

    // Send concurrently — one failure doesn't block the rest
    const results = await Promise.allSettled(
      rows.map(async (contact) => {
        const message = `Hi ${contact.name}, ${userName} has started a trip from ${from_} to ${to_} and is sharing their live location with you. Powered by Hadin.`;
        const result = await sendSMS(contact.phone, message);
        if (!result.success) {
          console.warn(`[trips/notify-start] SMS failed for ${contact.name}:`, result.error);
        }
        return result;
      }),
    );

    const notified = results.filter(
      (r) => r.status === 'fulfilled' && r.value.success,
    ).length;

    res.status(200).json({ success: true, notified });
  },
);

// Preserve existing stub routes
router.post('/', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
router.get('/', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
router.get('/:id', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
router.patch('/:id', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
router.delete('/:id', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });

export default router;

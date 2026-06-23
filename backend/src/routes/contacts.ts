import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sendSMS } from '../services/notificationService';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { notifyRateLimit } from '../middleware/rateLimit';

const router = Router();

// ── POST /api/v1/contacts/notify ─────────────────────────────────────────────

const NotifySchema = z.object({
  contactPhone: z.string().regex(/^\+234[789]\d{9}$/, 'Must be a Nigerian E.164 number'),
  contactName: z.string().min(1),
  userName: z.string().min(1),
});

router.post(
  '/notify',
  requireAuth,
  notifyRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = NotifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Invalid request',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const { contactPhone, contactName, userName } = parsed.data;
    const userId = (req as AuthRequest).user.id;

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[contacts/notify] user=${userId} → ${contactPhone}`);
    }

    const message = `Hi ${contactName}, ${userName} added you to their Hadin safety circle. You'll be notified if they need help while travelling. hellohadin.netlify.app`;

    const result = await sendSMS(contactPhone, message);

    if (!result.success) {
      res.status(500).json({ error: result.error ?? 'SMS failed', code: 'SMS_FAILED' });
      return;
    }

    res.status(200).json({ success: true });
  },
);

// ── Stub routes (to be built) ─────────────────────────────────────────────────

router.get('/', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
router.post('/', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
router.delete('/:id', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });

export default router;

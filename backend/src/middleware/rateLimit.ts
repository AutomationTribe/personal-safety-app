import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request } from 'express';

type WithUser = { user?: { id: string } };

function userOrIp(req: Request): string {
  return (req as Request & WithUser).user?.id ?? ipKeyGenerator(req.ip ?? '');
}

export const sosRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  keyGenerator: userOrIp,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many SOS requests. Try again later.', code: 'RATE_LIMITED' });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const notifyRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: userOrIp,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many notify requests. Try again later.', code: 'RATE_LIMITED' });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

import { Router } from 'express';

const router = Router();

// POST /api/v1/sos
router.post('/', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });

// GET /api/v1/sos
router.get('/', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });

// PATCH /api/v1/sos/:id/resolve
router.patch('/:id/resolve', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });

export default router;

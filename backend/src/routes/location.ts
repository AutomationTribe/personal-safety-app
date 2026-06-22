import { Router } from 'express';

const router = Router();

// POST /api/v1/location/ping
router.post('/ping', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });

// POST /api/v1/location/batch
router.post('/batch', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });

// GET /api/v1/location/:tripId
router.get('/:tripId', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });

export default router;

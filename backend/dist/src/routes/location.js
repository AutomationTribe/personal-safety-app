"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
// POST /api/v1/location/ping
router.post('/ping', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
// POST /api/v1/location/batch
router.post('/batch', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
// GET /api/v1/location/:tripId
router.get('/:tripId', (_req, res) => { res.status(501).json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }); });
exports.default = router;

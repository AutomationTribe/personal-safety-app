"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const swagger_setup_1 = require("../docs/swagger-setup");
const trips_1 = __importDefault(require("./routes/trips"));
const location_1 = __importDefault(require("./routes/location"));
const sos_1 = __importDefault(require("./routes/sos"));
const contacts_1 = __importDefault(require("./routes/contacts"));
const payments_1 = __importDefault(require("./routes/payments"));
const auth_1 = __importDefault(require("./routes/auth"));
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
// Fallback defaults for development
const defaultOrigins = ['http://localhost:5173', 'http://localhost:3000'];
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow server-to-server (no Origin header) and known origins
        if (!origin ||
            ALLOWED_ORIGINS.includes(origin) ||
            (process.env.NODE_ENV !== 'production' && defaultOrigins.includes(origin))) {
            callback(null, true);
        }
        else {
            callback(new Error(`CORS: origin ${origin} not allowed`));
        }
    },
    credentials: true,
}));
// Capture raw body for Paystack webhook signature validation BEFORE json parser
app.use('/api/v1/payments/webhook', express_1.default.raw({ type: 'application/json' }), (req, _res, next) => {
    req.rawBody = req.body;
    next();
});
app.use(express_1.default.json());
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/api/v1/trips', trips_1.default);
app.use('/api/v1/location', location_1.default);
app.use('/api/v1/sos', sos_1.default);
app.use('/api/v1/contacts', contacts_1.default);
app.use('/api/v1/payments', payments_1.default);
app.use('/api/v1/auth', auth_1.default);
(0, swagger_setup_1.mountSwagger)(app);
exports.default = app;

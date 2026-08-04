import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { mountSwagger } from '../docs/swagger-setup';
import tripsRouter from './routes/trips';
import locationRouter from './routes/location';
import sosRouter from './routes/sos';
import contactsRouter from './routes/contacts';
import paymentsRouter from './routes/payments';
import authRouter from './routes/auth';

const app = express();

app.use(helmet());

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Fallback defaults for development
const defaultOrigins = ['http://localhost:5173', 'http://localhost:3000'];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server (no Origin header) and known origins
      if (
        !origin ||
        ALLOWED_ORIGINS.includes(origin) ||
        (process.env.NODE_ENV !== 'production' && defaultOrigins.includes(origin))
      ) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  }),
);

// Capture raw body for Paystack webhook signature validation BEFORE json parser
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }), (req, _res, next) => {
  (req as express.Request & { rawBody?: Buffer }).rawBody = req.body as Buffer;
  next();
});

app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/v1/trips', tripsRouter);
app.use('/api/v1/location', locationRouter);
app.use('/api/v1/sos', sosRouter);
app.use('/api/v1/contacts', contactsRouter);
app.use('/api/v1/payments', paymentsRouter);
app.use('/api/v1/auth', authRouter);

mountSwagger(app);

export default app;

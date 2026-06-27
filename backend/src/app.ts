import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { mountSwagger } from '../docs/swagger-setup';
import tripsRouter from './routes/trips';
import locationRouter from './routes/location';
import sosRouter from './routes/sos';
import contactsRouter from './routes/contacts';
import paymentsRouter from './routes/payments';

const app = express();

app.use(helmet());
app.use(cors());

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

mountSwagger(app);

export default app;

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { mountSwagger } from '../docs/swagger-setup';
import tripsRouter from './routes/trips';
import locationRouter from './routes/location';
import sosRouter from './routes/sos';
import contactsRouter from './routes/contacts';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/v1/trips', tripsRouter);
app.use('/api/v1/location', locationRouter);
app.use('/api/v1/sos', sosRouter);
app.use('/api/v1/contacts', contactsRouter);

mountSwagger(app);

export default app;

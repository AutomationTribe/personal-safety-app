import express from 'express';
import cors from 'cors';
import { mountSwagger } from '../docs/swagger-setup';
import tripsRouter from './routes/trips';
import locationRouter from './routes/location';
import sosRouter from './routes/sos';
import contactsRouter from './routes/contacts';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/v1/trips', tripsRouter);
app.use('/api/v1/location', locationRouter);
app.use('/api/v1/sos', sosRouter);
app.use('/api/v1/contacts', contactsRouter);

// Swagger UI — no-op in production
mountSwagger(app);

app.listen(PORT, () => {
  console.log(`[server] Hadin backend running on port ${PORT}`);
});

export default app;

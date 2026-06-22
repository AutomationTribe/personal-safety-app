import { Express } from 'express';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';

// Only mount Swagger UI in development — never expose API internals in production
export function mountSwagger(app: Express): void {
  if (process.env.NODE_ENV === 'production') return;

  // Lazy-require so swagger-ui-express is a devDependency and never bundled for prod
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const swaggerUi = require('swagger-ui-express') as typeof import('swagger-ui-express');

  const specPath = path.resolve(__dirname, 'swagger.yaml');
  const spec = yaml.load(fs.readFileSync(specPath, 'utf8')) as object;

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, {
    customSiteTitle: 'Hadin API Docs',
    swaggerOptions: {
      persistAuthorization: true,
    },
  }));

  console.log('[swagger] API docs available at http://localhost:3001/api/docs');
}

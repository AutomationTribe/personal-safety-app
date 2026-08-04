"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mountSwagger = mountSwagger;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const js_yaml_1 = __importDefault(require("js-yaml"));
// Only mount Swagger UI in development — never expose API internals in production
function mountSwagger(app) {
    if (process.env.NODE_ENV === 'production')
        return;
    // Lazy-require so swagger-ui-express is a devDependency and never bundled for prod
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const swaggerUi = require('swagger-ui-express');
    const specPath = path_1.default.resolve(__dirname, 'swagger.yaml');
    const spec = js_yaml_1.default.load(fs_1.default.readFileSync(specPath, 'utf8'));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, {
        customSiteTitle: 'Hadin API Docs',
        swaggerOptions: {
            persistAuthorization: true,
        },
    }));
    console.log('[swagger] API docs available at http://localhost:3001/api/docs');
}

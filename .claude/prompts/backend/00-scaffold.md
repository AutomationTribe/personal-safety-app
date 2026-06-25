# Prompt: Backend scaffold

## Agent
Backend Engineer — read .claude/agents/backend-engineer.md first.

## Goal
Scaffold the Node.js + Express + TypeScript backend from scratch.
Create all files. Do not write any route logic yet —
just the working skeleton.

## Structure to create
backend/
  src/
    routes/
      contacts.ts    (empty router, export default)
      trips.ts       (empty router, export default)
      location.ts    (empty router, export default)
      sos.ts         (empty router, export default)
    middleware/
      auth.ts        (verify Supabase JWT)
      validate.ts    (Zod validation wrapper)
      rateLimit.ts   (express-rate-limit setup)
    services/
      supabase.ts    (service role Supabase client)
      africastalking.ts (AT SDK initialisation)
    app.ts           (Express app, mount routes)
    server.ts        (listen on PORT)
  .env.example
  package.json
  tsconfig.json
  nodemon.json

## package.json dependencies
express, @supabase/supabase-js, africastalking,
zod, express-rate-limit, cors, helmet, dotenv

## package.json devDependencies
typescript, ts-node, nodemon, @types/express,
@types/node, @types/cors

## Auth middleware (auth.ts)
Verify Authorization: Bearer <jwt> header.
Use supabase.auth.getUser(token) to validate.
Attach user to req.user.
Return 401 { error: 'Unauthorized', code: 'AUTH_REQUIRED' }
if missing or invalid.

## app.ts mounts
- helmet()
- cors()
- express.json()
- /api/v1/contacts → contacts router
- /api/v1/trips → trips router
- /api/v1/location → location router
- /api/v1/sos → sos router
- GET /health → { status: 'ok', timestamp }

## .env.example
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
AT_API_KEY=
AT_USERNAME=
AT_SENDER_ID=HADIN
PORT=3001
NODE_ENV=development

## Rules
- TypeScript strict, no any
- All error responses: { error: string, code: string }
- Service role key ONLY in backend/src/services/supabase.ts
- Never import service role key anywhere else
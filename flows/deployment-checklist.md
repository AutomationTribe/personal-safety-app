# Deployment Checklist

Recreated from git history + current repo state (no prior checklist file existed).

## Backend (Railway)
- [x] `nixpacks.toml` installs devDeps so `tsc` is available at build time
- [x] `typescript` moved to production `dependencies`
- [x] `.gitignore` scoped so `backend/dist` is tracked, mobile/dashboard `dist` ignored
- [x] Node 22 required (native WebSocket support)
- [x] `backend/railway.json` present — build: `npm install && npm run build`, start: `node dist/src/index.js`, healthcheck: `/health`
- [ ] Commit the currently-modified `backend/package-lock.json`
- [ ] Confirm Railway project env vars are set: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TERMII_API_KEY`, `PORT`, `NODE_ENV=production` (only `.env.example` exists locally — verify these are set in the Railway dashboard, not just `.env`)
- [ ] Trigger a deploy and confirm `/health` returns OK on the live Railway URL
- [ ] Confirm backend CORS allows the deployed dashboard origin (SEC fix from `57ed466` made CORS dev-only — verify prod origin is allowed)

## Dashboard (Vercel)
- [ ] No `vercel.json` found in `dashboard/` — confirm whether deploy is configured via Vercel's dashboard UI instead, or needs one
- [ ] Point dashboard's Supabase/API base URL env vars at the live Railway backend
- [ ] Deploy and verify `LiveMap.tsx` / `AlertQueue.tsx` connect to Supabase Realtime in production

## Mobile (EAS)
- [x] `eas.json` production profile added (Android `app-bundle`, iOS `credentialsSource: remote`) — **uncommitted**
- [ ] **Blocking:** `mobile/google-play-key.json` (Play Console service account key) is referenced in `eas.json` submit config but does not exist in `mobile/` — obtain and add it (keep out of git, confirm it's gitignored)
- [ ] **Blocking:** `ascAppId` and `appleTeamId` in `eas.json` iOS submit config are empty — fill in from App Store Connect
- [ ] Commit `mobile/eas.json` once the above are resolved
- [ ] Run `eas build --profile production` for both platforms
- [ ] Run `eas submit` for internal/TestFlight track
- [ ] Sanity check `mobile/app.json` — Google Maps API key is committed in plaintext; confirm it's restricted (Android package + SHA-1) in Google Cloud Console

## Cross-cutting
- [ ] Merge outstanding security/perf fix branches if not already in `main` (`cee194c`, `22a5ebe` look merged — confirm no stragglers)
- [ ] Smoke-test SOS SMS fallback against the deployed backend (Africa's Talking / Termii live keys, not sandbox)

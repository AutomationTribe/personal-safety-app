# Travel Safety App

## What this app does
A mobile app that tracks traveller GPS location at configurable intervals 
(default 30 min) during state-to-state or city-to-city trips in Nigeria. 
Sends SOS alerts via internet or falls back to SMS/USSD when offline. 
Streams live location to a web dashboard for responders.

## Stack
- Mobile: React Native (Expo) + react-native-background-geolocation
- Backend: Node.js + Express + Supabase (PostgreSQL + PostGIS + Realtime)
- Dashboard: React + Vite + Leaflet.js
- SMS/USSD fallback: Africa's Talking
- Push notifications: Firebase Cloud Messaging
- Hosting: Railway (backend) + Vercel (dashboard)

## Offline-first rules — never break these
- GPS pings are always written to local SQLite queue first, then synced
- SOS fires immediately regardless of poll interval
- If internet fails during SOS, fall back to native device SMS automatically
- Never assume connectivity — always check before any network call

## Git workflow — always follow this
- Every new service, feature, or screen gets its own branch off `main`
- Branch naming: `feature/<service-name>` e.g. `feature/location-service`
- When work is complete, merge back into `main` and delete the feature branch
- Never commit directly to `main`
- Commit messages must describe the why, not just the what

## Project commands
- `cd mobile && npx expo start` — run mobile dev server
- `cd backend && npm run dev` — run backend on port 3001
- `cd dashboard && npm run dev` — run dashboard on port 5173
- `npm test` — run Jest tests

## Conventions
- TypeScript strict mode everywhere, no `any` types
- Supabase client always imported from `lib/supabase.ts` in each layer
- All backend API routes prefixed with `/api/v1/`
- SMS SOS body format: "SOS [userId] [lat],[lng] [timestamp]"
- All location data stored as PostGIS geography type, not plain floats
- Error responses always follow shape: `{ error: string, code: string }`
- Every service file must handle both online and offline cases explicitly

## Agent rules
- Mobile engineer: only touch files inside mobile/
- Backend engineer: only touch files inside backend/
- Dashboard engineer: only touch files inside dashboard/
- Never modify files outside your assigned layer without explicit instruction

## Key files
- `mobile/src/services/LocationService.ts` — GPS polling + offline queue
- `mobile/src/services/SOSService.ts` — SOS trigger + SMS fallback
- `mobile/src/hooks/useNetworkStatus.ts` — connectivity detection
- `backend/src/routes/location.ts` — location ingestion endpoint
- `backend/src/routes/sos.ts` — SOS event processor
- `backend/src/services/deviationEngine.ts` — trip change detection
- `dashboard/src/components/LiveMap.tsx` — real-time map view
- `dashboard/src/components/AlertQueue.tsx` — SOS alert management

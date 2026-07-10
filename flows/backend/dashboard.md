# Backend Dashboard Flow

## Backend changes
N/A — all dashboard data is fetched directly from Supabase client-side using RLS-enforced queries.

No new backend endpoints are required for the idle dashboard view.

## Existing endpoints used by dashboard
- `POST /api/v1/sos` — triggered by SOS button during active trip (unchanged)
- `PATCH /api/v1/sos/:id/cancel` — cancel SOS (unchanged)

## Realtime
Supabase Realtime subscription on `trips` table handles live trip status changes client-side.
No backend WebSocket layer needed.

## Future (not yet implemented)
- Day 8 trial-end reminder push notification (Edge Function, scheduled)
- Always-online ping ingestion endpoint (if always-online pings need server validation)

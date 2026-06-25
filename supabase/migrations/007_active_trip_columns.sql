-- Migration: 007_active_trip_columns.sql
-- Adds contact_ids to trips and cancelled_at to sos_events.
-- Enables Realtime on both tables.
--
-- Rollback:
--   ALTER TABLE public.trips DROP COLUMN IF EXISTS contact_ids;
--   ALTER TABLE public.sos_events DROP COLUMN IF EXISTS cancelled_at;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.trips;

-- trips: array of trusted contact UUIDs notified on this trip
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS contact_ids uuid[] NOT NULL DEFAULT '{}';

-- sos_events: when (and if) a user cancelled an SOS before resolution
ALTER TABLE public.sos_events
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Enable Realtime on trips (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'trips'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
  END IF;
END $$;

-- Enable Realtime on sos_events (idempotent — already added in 005 but safe to re-check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'sos_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sos_events;
  END IF;
END $$;

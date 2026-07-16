-- Migration: 009_user_mode_support.sql
-- Supports the User Mode feature (flows/mobile/user-mode.md):
--   1. Always Online tracking is not tied to a trip — location_pings.trip_id
--      must be nullable so continuous pings can be written without one.
--   2. Two-tier SOS escalation during Trip Mode's stop-too-long detector:
--      alert_level 1 = circle + monitoring center (existing behaviour),
--      alert_level 2 = monitoring center only, no circle SMS (silent).
--   3. Arrival detection needs destination coordinates — trips only stored
--      destination as free text; add nullable lat/lng populated by a
--      best-effort geocode of the destination string on trip creation.
--
-- Rollback:
--   ALTER TABLE public.location_pings ALTER COLUMN trip_id SET NOT NULL;
--   ALTER TABLE public.sos_events DROP CONSTRAINT IF EXISTS sos_events_alert_level_check;
--   ALTER TABLE public.sos_events DROP COLUMN IF EXISTS alert_level;
--   ALTER TABLE public.trips DROP COLUMN IF EXISTS destination_lat;
--   ALTER TABLE public.trips DROP COLUMN IF EXISTS destination_lng;
--   (Note: SET NOT NULL will fail if any Always Online pings with trip_id
--   IS NULL have been written — delete them first if truly rolling back.)

ALTER TABLE public.location_pings
  ALTER COLUMN trip_id DROP NOT NULL;

ALTER TABLE public.sos_events
  ADD COLUMN IF NOT EXISTS alert_level smallint NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sos_events_alert_level_check'
  ) THEN
    ALTER TABLE public.sos_events
      ADD CONSTRAINT sos_events_alert_level_check CHECK (alert_level IN (1, 2));
  END IF;
END $$;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS destination_lat double precision,
  ADD COLUMN IF NOT EXISTS destination_lng double precision;

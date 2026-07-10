-- Migration: 008_history_geo_helpers.sql
-- Adds contacts_total/contacts_notified to sos_events (already written by
-- backend/src/routes/sos.ts but never added to the schema — every SMS-path
-- SOS insert has been silently failing without these columns).
-- Adds two SECURITY INVOKER RPCs so the mobile History feature can read
-- lat/lng out of PostGIS geography columns without shipping a WKB parser —
-- both run as the calling user, so the existing auth.uid() RLS policies on
-- location_pings and sos_events still apply.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_trip_location_pings(uuid);
--   DROP FUNCTION IF EXISTS public.get_trip_sos_events(uuid);
--   ALTER TABLE public.sos_events DROP COLUMN IF EXISTS contacts_total;
--   ALTER TABLE public.sos_events DROP COLUMN IF EXISTS contacts_notified;

ALTER TABLE public.sos_events
  ADD COLUMN IF NOT EXISTS contacts_total    int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contacts_notified int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.get_trip_location_pings(p_trip_id uuid)
RETURNS TABLE (
  id         uuid,
  lat        double precision,
  lng        double precision,
  accuracy   real,
  speed      real,
  heading    real,
  created_at timestamptz
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT
    id,
    ST_Y(coords::geometry) AS lat,
    ST_X(coords::geometry) AS lng,
    accuracy,
    speed,
    heading,
    created_at
  FROM public.location_pings
  WHERE trip_id = p_trip_id
  ORDER BY created_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_trip_sos_events(p_trip_id uuid)
RETURNS TABLE (
  id                uuid,
  lat               double precision,
  lng               double precision,
  triggered_at      timestamptz,
  delivery_method   sos_delivery_method,
  resolved_at       timestamptz,
  cancelled_at      timestamptz,
  notes             text,
  contacts_total    int,
  contacts_notified int
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT
    id,
    ST_Y(coords::geometry) AS lat,
    ST_X(coords::geometry) AS lng,
    triggered_at,
    delivery_method,
    resolved_at,
    cancelled_at,
    notes,
    contacts_total,
    contacts_notified
  FROM public.sos_events
  WHERE trip_id = p_trip_id
  ORDER BY triggered_at ASC;
$$;

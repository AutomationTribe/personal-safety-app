CREATE TYPE sos_delivery_method AS ENUM ('internet', 'sms', 'both');

CREATE TABLE IF NOT EXISTS public.sos_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coords          geography(Point, 4326) NOT NULL,
  triggered_at    timestamptz NOT NULL DEFAULT now(),
  delivery_method sos_delivery_method NOT NULL DEFAULT 'internet',
  resolved_at     timestamptz,
  resolved_by     text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sos_events_trip_id_idx ON public.sos_events(trip_id);
CREATE INDEX sos_events_user_id_idx ON public.sos_events(user_id);
CREATE INDEX sos_events_coords_idx  ON public.sos_events USING GIST(coords);

ALTER TABLE public.sos_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own SOS events"
  ON public.sos_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own SOS events"
  ON public.sos_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own SOS events"
  ON public.sos_events FOR UPDATE
  USING (auth.uid() = user_id);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.sos_events;

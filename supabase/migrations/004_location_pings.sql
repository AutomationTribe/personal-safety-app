CREATE TYPE ping_source AS ENUM ('gps', 'network', 'passive');

CREATE TABLE IF NOT EXISTS public.location_pings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coords     geography(Point, 4326) NOT NULL,
  accuracy   float4,
  speed      float4,
  heading    float4,
  source     ping_source NOT NULL DEFAULT 'gps',
  synced_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX location_pings_trip_id_idx    ON public.location_pings(trip_id);
CREATE INDEX location_pings_user_id_idx    ON public.location_pings(user_id);
CREATE INDEX location_pings_created_at_idx ON public.location_pings(created_at DESC);
CREATE INDEX location_pings_coords_idx     ON public.location_pings USING GIST(coords);

ALTER TABLE public.location_pings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pings"
  ON public.location_pings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pings"
  ON public.location_pings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.location_pings;

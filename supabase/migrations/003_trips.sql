CREATE TYPE trip_status AS ENUM ('active', 'completed', 'sos');

CREATE TABLE IF NOT EXISTS public.trips (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title                     text,
  origin                    text,
  destination               text,
  status                    trip_status NOT NULL DEFAULT 'active',
  started_at                timestamptz,
  ended_at                  timestamptz,
  expected_duration_minutes int,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trips_user_id_idx ON public.trips(user_id);
CREATE INDEX trips_status_idx  ON public.trips(status);

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trips"
  ON public.trips FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trips"
  ON public.trips FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trips"
  ON public.trips FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own trips"
  ON public.trips FOR DELETE
  USING (auth.uid() = user_id);

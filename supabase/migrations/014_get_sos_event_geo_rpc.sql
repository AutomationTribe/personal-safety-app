create or replace function public.get_sos_event_geo(p_sos_id uuid)
returns table (lat double precision, lng double precision)
language sql
security invoker
stable
as $$
  select ST_Y(coords::geometry) as lat, ST_X(coords::geometry) as lng
  from public.sos_events
  where id = p_sos_id
    and coords is not null;
$$;

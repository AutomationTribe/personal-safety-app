alter table public.sos_events
  add column battery_level smallint null check (battery_level is null or (battery_level >= 0 and battery_level <= 100)),
  add column network_type text null;

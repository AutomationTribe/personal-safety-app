-- Manual SOS can be triggered from the idle dashboard with no active trip
-- (flows/mobile/sos-manual.md) — trip_id becomes optional context, not a
-- hard requirement for firing an SOS.
alter table public.sos_events alter column trip_id drop not null;

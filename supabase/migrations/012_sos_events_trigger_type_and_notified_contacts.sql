create type sos_trigger_type as enum ('manual', 'accident', 'trip_auto');

alter table public.sos_events
  add column trigger_type sos_trigger_type not null default 'manual',
  add column notified_contact_ids uuid[] not null default '{}';

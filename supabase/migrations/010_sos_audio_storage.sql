-- SOS audio chunk storage: private bucket, path convention [sos_event_id]/[chunk_n].m4a
insert into storage.buckets (id, name, public)
values ('sos-audio', 'sos-audio', false)
on conflict (id) do nothing;

create policy "Users can upload SOS audio to their own events"
on storage.objects for insert
with check (
  bucket_id = 'sos-audio'
  and exists (
    select 1 from public.sos_events se
    where se.id::text = (storage.foldername(name))[1]
      and se.user_id = auth.uid()
  )
);

create policy "Users can read their own SOS audio"
on storage.objects for select
using (
  bucket_id = 'sos-audio'
  and exists (
    select 1 from public.sos_events se
    where se.id::text = (storage.foldername(name))[1]
      and se.user_id = auth.uid()
  )
);

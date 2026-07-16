create policy "Users can delete their own SOS audio"
on storage.objects for delete
using (
  bucket_id = 'sos-audio'
  and exists (
    select 1 from public.sos_events se
    where se.id::text = (storage.foldername(name))[1]
      and se.user_id = auth.uid()
  )
);

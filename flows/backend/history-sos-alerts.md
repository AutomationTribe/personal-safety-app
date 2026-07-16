# History — SOS Alerts Backend Flow

Source: `flows/General/general.md` — "History", plus
`flows/backend/sos-manual.md`. All of this is handled via direct Supabase
client queries from mobile (RLS-gated by `auth.uid()`) — no new
`/api/v1/*` Express routes were needed for this pass, consistent with
`flows/backend/history.md`'s existing "N/A" for the trips/pings side of
History.

## `sos_events` — new columns (migration `012_sos_events_trigger_type_and_notified_contacts.sql`, applied live)

```sql
create type sos_trigger_type as enum ('manual', 'accident', 'trip_auto');

alter table public.sos_events
  add column trigger_type sos_trigger_type not null default 'manual',
  add column notified_contact_ids uuid[] not null default '{}';
```

- `trigger_type` — set by `backend/src/routes/sos.ts` at insert time:
  `'manual'` on the level-1 (SOS-button) path, `'trip_auto'` on the level-2
  (silent stop-detector check-in) path. `'accident'` exists in the enum for
  a future accident-detection feature but nothing writes it today.
- `notified_contact_ids` — populated on the level-1 path only (level-2
  never notifies anyone) with the `id`s of every `trusted_contacts` row the
  SMS/email loop attempted to reach (trip's `contact_ids`, or the
  `notify_on_sos = true` fallback for a trip-less SOS) — not filtered down
  to only successful sends, since a contact whose SMS failed was still
  "notified" in the sense of being circle-designated for this alert.
  Historical rows created before this migration default to `'{}'`.

## Audio signed URL — playback

**N/A as a backend endpoint** — handled entirely client-side via the
`supabase-js` Storage client, same pattern as the existing chunk upload in
`SOSAudioService.ts`:

```ts
const { data } = await supabase.storage.from('sos-audio').createSignedUrl(path, 300);
```

The `sos-audio` bucket's existing RLS `select` policy (migration
`010_sos_audio_storage.sql`) already scopes this to the owning user via
`(storage.foldername(name))[1]` matching a `sos_events.id` owned by
`auth.uid()` — no service-role bypass needed, no new policy required for
playback.

## Audio deletion

**N/A as a backend endpoint** — also handled client-side, but required a
**new RLS policy** since the original migration only granted `insert` and
`select` on `storage.objects` for `sos-audio`, not `delete`:

`013_sos_audio_storage_delete_policy.sql` (applied live):
```sql
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
```

Mobile lists all objects under `{sosId}/` via `supabase.storage.from('sos-audio').list(sosId)`,
then calls `.remove()` with the full path list — both now permitted by RLS
for the owning user directly, no backend route or service-role key
involved.

## `get_sos_event_geo` RPC (migration `014_get_sos_event_geo_rpc.sql`, applied live)

```sql
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
```

Same reasoning as the existing `get_trip_location_pings` /
`get_trip_sos_events` RPCs in `008_history_geo_helpers.sql`: PostgREST
serializes `geography(Point,4326)` as WKB hex by default, so
`SOSDetailScreen`'s map marker needs this tiny `SECURITY INVOKER` helper to
get plain `lat`/`lng` floats instead of parsing WKB client-side. Returns no
rows for the ~2 pre-`coords`-fix historical events where `coords` is null
— mobile treats an empty result as "location not recorded".

## Queries used by `SOSDetailScreen`

- `supabase.from('sos_events').select('*').eq('id', sosId).single()` — full
  row (RLS already restricts to `auth.uid()`, no need for an explicit
  `.eq('user_id', ...)`, matching the existing pattern in
  `TripDetailScreen`).
- `supabase.rpc('get_sos_event_geo', { p_sos_id: sosId })` — marker
  coordinates.
- `supabase.from('trusted_contacts').select('id, name').in('id', notified_contact_ids)`
  — circle-notified names (skipped entirely if the array is empty).
- `supabase.storage.from('sos-audio').list(sosId)` — chunk file listing.

## Bug found in passing

None this pass — `008_history_geo_helpers.sql`'s previously-documented
`contacts_total`/`contacts_notified` column bug was already fixed in an
earlier migration, confirmed still correct on the live schema before this
pass began.

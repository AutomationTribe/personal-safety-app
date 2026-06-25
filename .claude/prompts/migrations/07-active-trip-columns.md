# Migration 007 — Active Trip Columns

Agent: database-engineer

## Before writing anything

Read these files:
- supabase/migrations/003_trips.sql
- supabase/migrations/005_sos_events.sql

## Task

Write `supabase/migrations/007-active-trip-columns.sql`.

### Changes required

**trips table** — add if not exists:
```sql
contact_ids uuid[] NOT NULL DEFAULT '{}'
```

**sos_events table** — add if not exists:
```sql
cancelled_at timestamptz
```

### Realtime

Enable Realtime publication on both tables:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE trips;
ALTER PUBLICATION supabase_realtime ADD TABLE sos_events;
```

### Rules
- Wrap every column addition in `IF NOT EXISTS` guard or use `DO $$ BEGIN ... EXCEPTION WHEN duplicate_column THEN NULL; END $$`
- Do not drop or alter existing columns
- No data migrations — only schema changes
- Migration must be idempotent (safe to run twice)

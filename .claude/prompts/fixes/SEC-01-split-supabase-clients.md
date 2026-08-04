# SEC-01 — Canonicalize supabaseAdmin: eliminate the local client in payments.ts

## What to fix

**File:** `backend/src/lib/supabase.ts` and `backend/src/routes/payments.ts` (lines 23–26)

`payments.ts` declares its own local `supabaseAdmin` client inline (lines 23–26), constructed directly from env vars. This is the only place the name `supabaseAdmin` appears in the codebase. Two separate `createClient` calls for the same key can diverge in configuration over time (options, auth settings, timeouts) and create subtle inconsistencies. The canonical client definition belongs in `lib/supabase.ts`, not in a route file.

The existing `supabase` export in `lib/supabase.ts` is correctly using the service-role key and must remain unchanged — the service-role key is required on the backend because no user JWT is ever injected into the Supabase client's session headers, meaning `auth.uid()` would return null if the anon key were used, breaking every RLS policy that calls `auth.uid()`.

## Why it matters

- Having a second `createClient` call in a route file means any configuration change (e.g. adding `db.schema`, changing `auth` options, or injecting a global header) must be applied in two places.
- SEC-14 will need to call `supabaseAdmin.auth.admin.getUserById()` — that import must resolve to a single, canonical, service-role client. If it does not exist in `lib/supabase.ts`, SEC-14 has nowhere clean to import it from.

## Exact fix

### Step 1 — `backend/src/lib/supabase.ts`

Add a named `supabaseAdmin` export as an alias for the existing `supabase` client. Do not change the `supabase` export and do not introduce a new `createClient` call.

**Before:**
```ts
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment.');
}

// Service role client — bypasses RLS. NEVER expose to mobile.
export const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});
```

**After:**
```ts
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment.');
}

// Service role client — bypasses RLS. NEVER expose to mobile.
export const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// Canonical alias for use in routes that need an explicit "admin" name
// (payments, webhook user-existence checks). Same client instance — not a
// second createClient call.
export const supabaseAdmin = supabase;
```

### Step 2 — `backend/src/routes/payments.ts`

Delete the local `supabaseAdmin` declaration (lines 22–26 in the current file):

```ts
// DELETE these lines:
// Service-role client for writing to profiles without RLS restrictions
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);
```

Update the import at the top of the file to include `supabaseAdmin`:

**Before:**
```ts
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
```

**After:**
```ts
import { supabase, supabaseAdmin } from '../lib/supabase';
```

Remove the now-unused `import { createClient } from '@supabase/supabase-js'` line if `createClient` is no longer referenced anywhere else in `payments.ts` (it won't be after this change).

### Step 3 — No other files need to change

All other routes (`sos.ts`, `trips.ts`, `contacts.ts`, `middleware/auth.ts`) already import `supabase` from `lib/supabase` and continue to use it exactly as before. They do not need `supabaseAdmin` unless they are performing a privileged write — none currently do.

## Files to touch

- `backend/src/lib/supabase.ts`
- `backend/src/routes/payments.ts`

## Test steps

1. Run `cd backend && npx tsc --noEmit` — must pass with no errors. The removed `createClient` import and the new `supabaseAdmin` export must resolve cleanly.
2. Run `npm run dev` in `backend/` — server must start without throwing.
3. Call `POST /api/v1/payments/trial/start` with a valid Bearer token — expect `{ success: true }` and a profile row updated in Supabase.
4. Call `POST /api/v1/payments/verify` with a valid Paystack reference — expect the profile's `subscription_status` updated to `'active'`.
5. Grep `backend/src/routes/payments.ts` for `createClient` — must return no matches (confirms the local client is gone).
6. Grep `backend/src/lib/supabase.ts` for `supabaseAdmin` — must return one match (the alias export).

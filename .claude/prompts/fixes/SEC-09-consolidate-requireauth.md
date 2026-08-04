# SEC-09 — Remove duplicate `requireAuth` implementations in trips.ts and payments.ts

## What to fix

**Files:** `backend/src/routes/trips.ts` (lines 10–28), `backend/src/routes/payments.ts` (lines 30–50)

Both files define a local `requireAuth` function that is identical in structure to the canonical implementation in `backend/src/middleware/auth.ts`. Three copies of the same auth logic mean a security fix to one copy (e.g. adding token revocation checks, changing error codes, or adding logging) must be applied to three places — and the duplicates will silently drift.

Additionally, the local copy in `trips.ts` uses `typeof user` (Supabase's internal User type inferred from the SDK) as the type for `req.user`, while the canonical version uses the explicit `User` import from `@supabase/supabase-js` and the exported `AuthRequest` interface. The `payments.ts` copy uses a narrower inline type `{ id: string; email?: string }`.

`sos.ts` and `contacts.ts` already correctly import from `middleware/auth`.

## Why it matters

Security-critical middleware must have a single implementation. Duplicate copies are a maintenance hazard — they diverge and create inconsistent behaviour across routes.

## Exact fix

### `backend/src/routes/trips.ts`

**Remove lines 10–28 (the local `requireAuth` function).**

**Change the import block — before:**
```ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { sendSMS } from '../services/africastalking';

const router = Router();

// ── Auth middleware ────────────────────────────────────────────────────────────

async function requireAuth(req: Request, res: Response, next: () => void): Promise<void> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    return;
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    return;
  }

  (req as Request & { user: typeof user }).user = user;
  next();
}
```

**After:**
```ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { sendSMS } from '../services/africastalking';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
```

Then update the route handler's user access. In the `/notify-start` handler, replace:
```ts
const authedReq = req as Request & { user: { id: string } };
// ...
const userId = authedReq.user.id;
```
with:
```ts
const userId = (req as AuthRequest).user.id;
```

Also update the middleware application on the route from the wrapper pattern to direct use:
```ts
// Before:
(req: Request, res: Response, next: () => void) => { requireAuth(req, res, next); },

// After:
requireAuth,
```

### `backend/src/routes/payments.ts`

**Remove lines 28–50 (the `AuthedRequest` type and local `requireAuth` function).**

**Change the import block — before:**
```ts
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
```

**After:**
```ts
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { requireAuth, AuthRequest } from '../middleware/auth';
```

Then replace all occurrences of `(req as AuthedRequest).user` with `(req as AuthRequest).user` throughout `payments.ts`.

Replace all route registrations that use the cast pattern:
```ts
// Before:
requireAuth as unknown as Parameters<typeof router.post>[1]

// After:
requireAuth
```

(The cast was needed because the local `requireAuth` had `next: () => void` instead of `NextFunction`. The canonical version in `middleware/auth.ts` already uses `NextFunction`, so no cast is needed.)

## Files to touch

- `backend/src/routes/trips.ts`
- `backend/src/routes/payments.ts`

## Test steps

1. `cd backend && npx tsc --noEmit` — must pass with no type errors after removing the duplicate types.
2. `POST /api/v1/trips/notify-start` with a valid Bearer token — 200 response.
3. `POST /api/v1/trips/notify-start` with no Bearer token — 401 `{ code: 'AUTH_REQUIRED' }`.
4. `POST /api/v1/payments/init` with a valid Bearer token — 200 response.
5. `POST /api/v1/payments/trial/start` with an expired/invalid token — 401.
6. Grep for `async function requireAuth` in `backend/src/routes/` — must return no matches.

# SEC-08 — Restrict CORS to known origins

## What to fix

**File:** `backend/src/app.ts` (line 15)

```ts
app.use(cors());
```

Called with no options, `cors()` sets `Access-Control-Allow-Origin: *` on every response, allowing any web page on any domain to make credentialed cross-origin requests to the API. This makes CSRF-style attacks trivially possible from any browser tab.

## Why it matters

An open CORS policy means any third-party website can make requests to the Hadin API using a logged-in user's cookies/session — in combination with other vulnerabilities (e.g. XSS on a third-party site), this becomes exploitable. The backend should only accept browser-originated requests from the known dashboard and marketing site.

## Exact fix

**`backend/src/app.ts` — before:**
```ts
app.use(cors());
```

**After:**
```ts
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Fallback defaults for development
const defaultOrigins = ['http://localhost:5173', 'http://localhost:3000'];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server (no Origin header) and known origins
      if (!origin || ALLOWED_ORIGINS.includes(origin) || defaultOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  }),
);
```

**Add to `.env` (and Railway environment variables):**
```
ALLOWED_ORIGINS=https://hadin.app,https://hellohadin.netlify.app
```

The mobile app makes direct HTTP calls (no browser CORS), so blocking non-whitelisted origins does not affect mobile functionality.

## Files to touch

- `backend/src/app.ts`

## Test steps

1. Send a request to `/health` with `Origin: https://evil.example.com` — response must NOT include `Access-Control-Allow-Origin` (or must return a CORS error in the browser).
2. Send a request with `Origin: https://hadin.app` — response must include `Access-Control-Allow-Origin: https://hadin.app`.
3. Send a request with `Origin: https://hellohadin.netlify.app` — same as above, should be allowed.
4. Open `http://localhost:5173` in a browser during development and confirm the dashboard can still reach the API (localhost is in the default origins list).
5. `cd backend && npx tsc --noEmit` — no type errors.

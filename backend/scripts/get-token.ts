import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? '';

if (!url || !anonKey) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY in backend/.env');
  process.exit(1);
}

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error('Usage: npx ts-node -r dotenv/config scripts/get-token.ts <email> <password>');
  process.exit(1);
}

const client = createClient(url, anonKey);

void (async () => {
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    console.error('Login failed:', error?.message ?? 'no session');
    process.exit(1);
  }

  console.log('\n── JWT Token ──────────────────────────────────────────────');
  console.log(data.session.access_token);
  console.log('───────────────────────────────────────────────────────────\n');
  console.log('User ID:', data.session.user.id);
  console.log('Expires:', new Date(data.session.expires_at! * 1000).toISOString());
})();

import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { getCurrentLocation } from './LocationService';
import { checkIsOnline } from '../hooks/useNetworkStatus';

export interface SOSResult {
  success: boolean;
  method: 'internet' | 'sms' | 'both' | 'failed';
  error?: string;
}

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';
const CONTACTS_CACHE_KEY = 'HADIN_TRUSTED_CONTACTS_CACHE';

// ── Trusted contacts cache ───────────────────────────────────────────────────

interface CachedContact {
  phone: string;
  name: string;
}

async function fetchContactsFromSupabase(): Promise<CachedContact[]> {
  const { data, error } = await supabase
    .from('trusted_contacts')
    .select('phone, name')
    .eq('notify_on_sos', true);

  if (error || !data) return [];
  return data as CachedContact[];
}

async function getCachedContacts(): Promise<CachedContact[]> {
  try {
    const raw = await AsyncStorage.getItem(CONTACTS_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CachedContact[];
  } catch {
    return [];
  }
}

async function cacheContacts(contacts: CachedContact[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(contacts));
  } catch {
    // Cache write failure is non-fatal
  }
}

// ── SMS fallback ─────────────────────────────────────────────────────────────

function buildSMSBody(userId: string, lat: number, lng: number, timestamp: string): string {
  return `SOS ${userId} ${lat},${lng} ${timestamp}`;
}

async function sendSMSFallback(
  phones: string[],
  userId: string,
  lat: number,
  lng: number,
  timestamp: string,
): Promise<boolean> {
  if (phones.length === 0) return false;

  const body = buildSMSBody(userId, lat, lng, timestamp);
  // sms: URI with multiple recipients uses semicolons on Android, commas on iOS —
  // React Native Linking normalises this well enough for both platforms.
  const recipients = phones.join(';');
  const url = `sms:${recipients}?body=${encodeURIComponent(body)}`;

  const supported = await Linking.canOpenURL(url);
  if (!supported) return false;

  await Linking.openURL(url);
  return true;
}

// ── Internet POST ─────────────────────────────────────────────────────────────

async function postSOSToBackend(
  tripId: string,
  lat: number,
  lng: number,
  timestamp: string,
): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const response = await fetch(`${BACKEND_URL}/api/v1/sos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ tripId, lat, lng, timestamp }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

// ── Supabase sos_events record ────────────────────────────────────────────────

async function writeSOSEvent(
  tripId: string,
  lat: number,
  lng: number,
  timestamp: string,
  deliveryMethod: 'internet' | 'sms' | 'both',
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('sos_events')
      .insert({
        trip_id: tripId,
        coords: `POINT(${lng} ${lat})`,
        triggered_at: timestamp,
        delivery_method: deliveryMethod,
      })
      .select('id')
      .single();

    if (error || !data) return null;
    return (data as { id: string }).id;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getSMSFallbackContacts(): Promise<string[]> {
  const online = await checkIsOnline();

  if (online) {
    const contacts = await fetchContactsFromSupabase();
    if (contacts.length > 0) {
      await cacheContacts(contacts);
      return contacts.map((c) => c.phone);
    }
  }

  // Fall back to cache when offline or Supabase returned nothing
  const cached = await getCachedContacts();
  return cached.map((c) => c.phone);
}

export async function triggerSOS(tripId: string): Promise<SOSResult> {
  // 1. Capture location immediately — never wait for next poll
  let lat: number;
  let lng: number;
  let timestamp: string;

  try {
    const loc = await getCurrentLocation();
    lat = loc.lat;
    lng = loc.lng;
    timestamp = loc.timestamp;
  } catch (err) {
    return {
      success: false,
      method: 'failed',
      error: 'Could not obtain GPS location.',
    };
  }

  // 2. Get current user id for SMS body
  const { data: { session } } = await supabase.auth.getSession().catch(() => ({
    data: { session: null },
  }));
  const userId = session?.user.id ?? 'unknown';

  // 3. Check connectivity
  const online = await checkIsOnline();

  let internetOk = false;
  let smsOk = false;

  if (online) {
    internetOk = await postSOSToBackend(tripId, lat, lng, timestamp);
  }

  // 4. SMS fallback if offline or internet POST failed
  if (!internetOk) {
    const phones = await getSMSFallbackContacts();
    smsOk = await sendSMSFallback(phones, userId, lat, lng, timestamp);
  }

  // 5. Determine delivery method
  const deliveryMethod: 'internet' | 'sms' | 'both' | 'failed' =
    internetOk && smsOk ? 'both'
    : internetOk        ? 'internet'
    : smsOk             ? 'sms'
    : 'failed';

  const success = deliveryMethod !== 'failed';

  // 6. Write sos_events record (best-effort — don't block on failure)
  if (success && online) {
    await writeSOSEvent(
      tripId,
      lat,
      lng,
      timestamp,
      deliveryMethod === 'both' ? 'both' : internetOk ? 'internet' : 'sms',
    );
  }

  return {
    success,
    method: deliveryMethod,
    ...(!success ? { error: 'Could not deliver SOS via internet or SMS.' } : {}),
  };
}

export async function cancelSOS(sosEventId: string): Promise<void> {
  const { error } = await supabase
    .from('sos_events')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: 'user',
    })
    .eq('id', sosEventId);

  if (error) {
    throw new Error(`Failed to cancel SOS event: ${error.message}`);
  }
}

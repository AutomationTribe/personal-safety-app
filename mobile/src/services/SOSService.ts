import * as Location from 'expo-location';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { checkIsOnline } from '../hooks/useNetworkStatus';

export interface SOSResult {
  success: boolean;
  eventId?: string;
  notified: number;
  total: number;
  error?: string;
}

export interface SOSContact {
  id: string;
  name: string;
  phone: string;
}

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';
const CONTACTS_CACHE_KEY = 'HADIN_SOS_CONTACTS_CACHE';

// ── Contact cache ─────────────────────────────────────────────────────────────
// Written whenever getSOSContacts succeeds so the SMS fallback has phones offline.

async function readContactCache(): Promise<SOSContact[]> {
  try {
    const raw = await AsyncStorage.getItem(CONTACTS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as SOSContact[]) : [];
  } catch {
    return [];
  }
}

async function writeContactCache(contacts: SOSContact[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(contacts));
  } catch {
    // non-fatal
  }
}

// ── SMS fallback ──────────────────────────────────────────────────────────────

async function openSMSFallback(phones: string[], lat: number, lng: number): Promise<void> {
  if (phones.length === 0) return;
  const body = `\u{1F6A8} SOS: I need help. My location: https://maps.google.com/?q=${lat},${lng} — Hadin Safety App`;
  // Semicolon-separated recipients work on both Android and iOS via Linking
  const url = `sms:${phones.join(';')}?body=${encodeURIComponent(body)}`;
  const supported = await Linking.canOpenURL(url);
  if (supported) await Linking.openURL(url);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch contacts for a trip from Supabase and cache them for offline SMS fallback.
 * Returns contacts that have notify_on_sos = true.
 */
export async function getSOSContacts(tripId: string): Promise<SOSContact[]> {
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('contact_ids')
    .eq('id', tripId)
    .single();

  if (tripError || !trip) return [];

  const contactIds = (trip as { contact_ids: string[] }).contact_ids ?? [];
  if (contactIds.length === 0) return [];

  const { data: rows, error: contactError } = await supabase
    .from('trusted_contacts')
    .select('id, name, phone')
    .in('id', contactIds)
    .eq('notify_on_sos', true);

  if (contactError || !rows) return [];

  const contacts = rows as SOSContact[];
  await writeContactCache(contacts);
  return contacts;
}

/**
 * Trigger an SOS alert.
 *
 * 1. Acquires GPS at Accuracy.High.
 * 2. POSTs to the backend (which inserts the event and sends SMS via AT).
 * 3. Falls back to opening the native SMS app if the backend is unreachable
 *    or returns a non-OK status (including 429 rate limit).
 *
 * Never throws — always returns SOSResult.
 */
export async function triggerSOS(
  tripId: string,
  contactIds: string[],
): Promise<SOSResult> {
  // 1. GPS at Accuracy.High — non-negotiable for SOS
  let lat: number;
  let lng: number;

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.error('[SOS] Location permission denied');
      return { success: false, notified: 0, total: contactIds.length, error: 'Location permission denied' };
    }
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    lat = position.coords.latitude;
    lng = position.coords.longitude;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[SOS] GPS failed:', msg);
    return { success: false, notified: 0, total: contactIds.length, error: 'Could not obtain GPS location' };
  }

  console.log(`[SOS] Triggered | trip=${tripId} lat=${lat} lng=${lng} contacts=${contactIds.length}`);

  // 2. Get JWT
  const { data: sessionData } = await supabase.auth.getSession().catch(() => ({
    data: { session: null },
  }));
  const token = sessionData.session?.access_token;

  // 3. Internet path
  try {
    const online = await checkIsOnline();

    if (online && token) {
      const response = await fetch(`${BACKEND_URL}/api/v1/sos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tripId, lat, lng, timestamp: new Date().toISOString() }),
      });

      if (response.ok) {
        const body = (await response.json()) as {
          success: boolean;
          eventId?: string;
          notified: number;
          total: number;
        };
        console.log(`[SOS] Backend OK | eventId=${body.eventId} notified=${body.notified}/${body.total}`);
        return { success: true, eventId: body.eventId, notified: body.notified, total: body.total };
      }

      // 429 rate limit or other non-OK → SMS fallback
      console.warn(`[SOS] Backend returned ${response.status} — SMS fallback`);
    }
  } catch (err) {
    console.warn('[SOS] Backend unreachable — SMS fallback:', err instanceof Error ? err.message : String(err));
  }

  // 4. SMS fallback — use cache, try a fresh fetch if cache is empty
  let fallbackContacts = await readContactCache();
  if (fallbackContacts.length === 0) {
    try {
      fallbackContacts = await getSOSContacts(tripId);
    } catch {
      // getSOSContacts already handles errors gracefully
    }
  }

  const phones = fallbackContacts.map((c) => c.phone);
  await openSMSFallback(phones, lat, lng);

  console.log(`[SOS] SMS fallback opened | phones=${phones.length}`);
  return {
    success: false,
    notified: 0,
    total: Math.max(contactIds.length, phones.length),
  };
}

/**
 * Cancel an active SOS via the backend PATCH endpoint.
 * Does not throw — returns success/error shape.
 */
export async function cancelSOS(
  eventId: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession().catch(() => ({
    data: { session: null },
  }));
  const token = sessionData.session?.access_token;

  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/sos/${eventId}/cancel`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) {
      console.log(`[SOS] Cancelled | eventId=${eventId}`);
      return { success: true };
    }

    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return { success: false, error: body.error ?? `HTTP ${response.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SOS] Cancel failed for ${eventId}:`, msg);
    return { success: false, error: msg };
  }
}

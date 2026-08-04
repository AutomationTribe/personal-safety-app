import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import NetInfo from '@react-native-community/netinfo';
import { Linking } from 'react-native';
import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';
import { checkIsOnline } from '../hooks/useNetworkStatus';

// Best-effort device snapshot for the SOS detail screen — never blocks or
// fails the trigger if either read fails.
async function getDeviceSnapshot(): Promise<{ batteryLevel: number | null; networkType: string | null }> {
  const [batteryLevel, networkType] = await Promise.all([
    Battery.getBatteryLevelAsync()
      .then((level) => (level >= 0 ? Math.round(level * 100) : null))
      .catch(() => null),
    NetInfo.fetch()
      .then((state) => {
        if (state.type === 'wifi') return 'Wi-Fi';
        if (state.type === 'cellular') return state.details?.cellularGeneration?.toUpperCase() ?? 'Cellular';
        if (state.isConnected) return state.type;
        return 'Offline';
      })
      .catch(() => null),
  ]);
  return { batteryLevel, networkType };
}

export interface SOSResult {
  success: boolean;
  eventId?: string;
  notified: number;
  total: number;
  error?: string;
  // True when the device had no internet at trigger time — the mobile UI
  // shows a distinct "No internet — SOS sent via SMS" banner for this case.
  offline?: boolean;
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
    // Primary: SecureStore (encrypted)
    const raw = await SecureStore.getItemAsync(CONTACTS_CACHE_KEY);
    if (raw) return JSON.parse(raw) as SOSContact[];

    // Fallback: legacy AsyncStorage entry (pre-SEC-12 data) — read once, then
    // migrate to SecureStore on next writeContactCache call.
    const legacyRaw = await AsyncStorage.getItem(CONTACTS_CACHE_KEY).catch(() => null);
    if (legacyRaw) return JSON.parse(legacyRaw) as SOSContact[];

    return [];
  } catch {
    return [];
  }
}

async function writeContactCache(contacts: SOSContact[]): Promise<void> {
  try {
    // Trim to max 5 contacts (first 5 from array), storing only name + phone.
    // This bounds the payload to well under SecureStore's 2 048-byte limit
    // (5 × ~40 bytes = ~200 bytes) and eliminates size concerns on Android.
    const trimmed: Pick<SOSContact, 'id' | 'name' | 'phone'>[] = contacts.slice(0, 5).map(({ id, name, phone }) => ({ id, name, phone }));
    await SecureStore.setItemAsync(CONTACTS_CACHE_KEY, JSON.stringify(trimmed));
    // Remove any legacy unencrypted AsyncStorage entry
    await AsyncStorage.removeItem(CONTACTS_CACHE_KEY).catch(() => null);
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

// ── Offline SOS queue (SQLite) ───────────────────────────────────────────────
// Written when SOS is triggered with no internet — the SMS composer fallback
// (above) already reaches the circle immediately, but the backend event
// (monitoring center record, contacts_notified, alert escalation) still
// needs to sync once connectivity returns.

let _sosDb: SQLite.SQLiteDatabase | null = null;

async function getSosDb(): Promise<SQLite.SQLiteDatabase> {
  if (_sosDb) return _sosDb;
  _sosDb = await SQLite.openDatabaseAsync('hadin.db');
  await _sosDb.execAsync(`
    CREATE TABLE IF NOT EXISTS sos_queue (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id    TEXT NOT NULL,
      lat        REAL NOT NULL,
      lng        REAL NOT NULL,
      timestamp  TEXT NOT NULL,
      contact_ids TEXT NOT NULL
    );
  `);
  return _sosDb;
}

async function queueOfflineSOS(tripId: string | null, lat: number, lng: number, timestamp: string, contactIds: string[]): Promise<void> {
  try {
    const db = await getSosDb();
    // sos_queue.trip_id is TEXT NOT NULL — store '' for a trip-less SOS and
    // translate back to null on sync, same convention as location_pings_queue.
    await db.runAsync(
      `INSERT INTO sos_queue (trip_id, lat, lng, timestamp, contact_ids) VALUES (?, ?, ?, ?, ?)`,
      [tripId ?? '', lat, lng, timestamp, JSON.stringify(contactIds)],
    );
  } catch (err) {
    console.warn('[SOS] Failed to queue offline event:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Sync any SQLite-queued offline SOS events to the backend. Call this when
 * connectivity is restored (e.g. from a `useNetworkStatus` transition to
 * online). Each row is POSTed exactly like a live trigger; successfully
 * synced rows are deleted, failures are left queued for the next attempt.
 * Never throws.
 */
export async function syncQueuedSOS(): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  try {
    const online = await checkIsOnline();
    if (!online) return { synced, failed };

    const db = await getSosDb();
    const rows = await db.getAllAsync<{
      id: number; trip_id: string; lat: number; lng: number; timestamp: string; contact_ids: string;
    }>(`SELECT * FROM sos_queue ORDER BY id ASC`);

    if (rows.length === 0) return { synced, failed };

    const { data: sessionData } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    const token = sessionData.session?.access_token;
    if (!token) return { synced, failed: rows.length };

    for (const row of rows) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/v1/sos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tripId: row.trip_id.length > 0 ? row.trip_id : null, lat: row.lat, lng: row.lng, timestamp: row.timestamp }),
        });
        if (response.ok) {
          await db.runAsync(`DELETE FROM sos_queue WHERE id = ?`, [row.id]);
          synced++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
  } catch (err) {
    console.warn('[SOS] Queue sync error:', err instanceof Error ? err.message : String(err));
  }

  console.log(`[SOS] Queue sync: ${synced} synced, ${failed} failed`);
  return { synced, failed };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch contacts for a trip from Supabase and cache them for offline SMS fallback.
 * Returns contacts that have notify_on_sos = true. Pass null for a trip-less
 * (idle dashboard) SOS — falls back to every circle contact opted into SOS
 * alerts, matching the backend's same fallback (backend/src/routes/sos.ts).
 */
export async function getSOSContacts(tripId: string | null): Promise<SOSContact[]> {
  let contactIds: string[] | null = null;

  if (tripId) {
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('contact_ids')
      .eq('id', tripId)
      .single();

    if (tripError || !trip) return [];
    contactIds = (trip as { contact_ids: string[] }).contact_ids ?? [];
    if (contactIds.length === 0) return [];
  }

  // `.in()` (when present) must precede the terminal `.eq()` — matches the
  // existing trip-scoped query's chain order.
  const base = supabase.from('trusted_contacts').select('id, name, phone');
  const { data: rows, error: contactError } = contactIds
    ? await base.in('id', contactIds).eq('notify_on_sos', true)
    : await base.eq('notify_on_sos', true);

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
  tripId: string | null,
  contactIds: string[],
  fallbackPhones?: string[],
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
  let wasOffline = false;
  try {
    const online = await checkIsOnline();
    wasOffline = !online;

    if (online && token) {
      const { batteryLevel, networkType } = await getDeviceSnapshot();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);

      try {
        const response = await fetch(`${BACKEND_URL}/api/v1/sos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ tripId, lat, lng, timestamp: new Date().toISOString(), batteryLevel, networkType }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

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
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        // AbortError means the 4 500 ms timeout fired — fall through to SMS fallback
        const isTimeout = fetchErr instanceof Error && fetchErr.name === 'AbortError';
        console.warn(`[SOS] Backend ${isTimeout ? 'timed out after 4500ms' : 'unreachable'} — SMS fallback`);
        // Re-throw so the outer catch block handles it and falls through to SMS fallback
        throw fetchErr;
      }
    }
  } catch (err) {
    console.warn('[SOS] Backend unreachable — SMS fallback:', err instanceof Error ? err.message : String(err));
  }

  // 3b. No internet at all — queue the event to sync once connectivity
  // returns, on top of the immediate SMS fallback below.
  if (wasOffline) {
    await queueOfflineSOS(tripId, lat, lng, new Date().toISOString(), contactIds);
  }

  // 4. SMS fallback — prefer phones passed by the caller (already in memory),
  // fall back to cache, then try a fresh fetch only as last resort.
  let phones: string[];
  if (fallbackPhones && fallbackPhones.length > 0) {
    phones = fallbackPhones;
  } else {
    let fallbackContacts = await readContactCache();
    if (fallbackContacts.length === 0) {
      try {
        fallbackContacts = await getSOSContacts(tripId);
      } catch {
        // getSOSContacts already handles errors gracefully
      }
    }
    phones = fallbackContacts.map((c) => c.phone);
  }

  await openSMSFallback(phones, lat, lng);

  console.log(`[SOS] SMS fallback opened | phones=${phones.length}`);
  return {
    success: false,
    notified: 0,
    total: Math.max(contactIds.length, phones.length),
    offline: wasOffline,
  };
}

/**
 * Fire a silent, 2nd-level "are you okay?" escalation — monitoring center
 * only, deliberately NEVER falls back to the native SMS composer (that
 * would text the user's personal circle, which is exactly what this tier
 * exists to avoid). If the backend is unreachable, the check-in is simply
 * dropped rather than escalated some other way. Never throws.
 */
export async function triggerSilentSOS(tripId: string): Promise<{ success: boolean }> {
  let lat: number;
  let lng: number;

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { success: false };
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    lat = position.coords.latitude;
    lng = position.coords.longitude;
  } catch {
    return { success: false };
  }

  const { data: sessionData } = await supabase.auth.getSession().catch(() => ({
    data: { session: null },
  }));
  const token = sessionData.session?.access_token;
  if (!token) return { success: false };

  try {
    const online = await checkIsOnline();
    if (!online) return { success: false };

    const response = await fetch(`${BACKEND_URL}/api/v1/sos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tripId, lat, lng, timestamp: new Date().toISOString(), alertLevel: 2 }),
    });

    if (response.ok) {
      console.log('[SOS] Silent (level-2) check-in sent');
      return { success: true };
    }
    console.warn(`[SOS] Silent check-in failed — backend returned ${response.status}`);
    return { success: false };
  } catch (err) {
    console.warn('[SOS] Silent check-in unreachable:', err instanceof Error ? err.message : String(err));
    return { success: false };
  }
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

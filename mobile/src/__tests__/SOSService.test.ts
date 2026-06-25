/**
 * SOSService unit tests
 *
 * Mocks: expo-location, react-native (Linking), @react-native-async-storage/async-storage,
 * ../lib/supabase, ../hooks/useNetworkStatus, global fetch
 *
 * No jest.resetModules() — incompatible with ts-jest preset.
 */

// ── expo-location mock ────────────────────────────────────────────────────────

jest.mock('expo-location', () => ({
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: 6.5244, longitude: 3.3792, accuracy: 15, speed: 0, heading: 0 },
    timestamp: Date.now(),
  }),
}));

// ── react-native mock (Linking) ───────────────────────────────────────────────

jest.mock('react-native', () => ({
  Linking: {
    canOpenURL: jest.fn().mockResolvedValue(true),
    openURL: jest.fn().mockResolvedValue(undefined),
  },
  Platform: { OS: 'ios' },
  Alert: { alert: jest.fn() },
  BackHandler: { exitApp: jest.fn() },
}));

// ── AsyncStorage mock ─────────────────────────────────────────────────────────

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));

// ── supabase mock ─────────────────────────────────────────────────────────────
//
// Two chains:
//   from('trips').select().eq().single()          → mockSingle
//   from('trusted_contacts').select().in().eq()   → mockContactsEq (terminal)

jest.mock('../lib/supabase', () => {
  const mockSingle = jest.fn();
  const mockContactsEq = jest.fn();
  const mockGetSession = jest.fn();

  // trips chain: .select().eq().single()
  const tripsChain = {
    select: jest.fn(),
    eq: jest.fn(),
    single: mockSingle,
  };
  tripsChain.select.mockReturnValue(tripsChain);
  tripsChain.eq.mockReturnValue(tripsChain);

  // trusted_contacts chain: .select().in().eq() — eq is the terminal promise
  const contactsChain = {
    select: jest.fn(),
    in: jest.fn(),
    eq: mockContactsEq,
  };
  contactsChain.select.mockReturnValue(contactsChain);
  contactsChain.in.mockReturnValue(contactsChain);

  const mockFrom = jest.fn().mockImplementation((table: string) => {
    if (table === 'trips') return tripsChain;
    if (table === 'trusted_contacts') return contactsChain;
    return {};
  });

  return {
    supabase: {
      from: mockFrom,
      auth: { getSession: mockGetSession },
    },
    __mockFns: { mockSingle, mockContactsEq, mockGetSession, mockFrom },
  };
});

// ── useNetworkStatus mock ─────────────────────────────────────────────────────

jest.mock('../hooks/useNetworkStatus', () => ({
  checkIsOnline: jest.fn().mockResolvedValue(true),
}));

// ── Imports (after all mocks) ─────────────────────────────────────────────────

import * as Location from 'expo-location';
import { triggerSOS, cancelSOS, getSOSContacts } from '../services/SOSService';

// ── Typed mock references ─────────────────────────────────────────────────────

const mockLocation = Location as jest.Mocked<typeof Location>;

const { Linking } = jest.requireMock('react-native') as {
  Linking: { canOpenURL: jest.Mock; openURL: jest.Mock };
};

const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage').default as {
  getItem: jest.Mock;
  setItem: jest.Mock;
};

const { __mockFns: sm } = jest.requireMock('../lib/supabase') as {
  __mockFns: {
    mockSingle: jest.Mock;
    mockContactsEq: jest.Mock;
    mockGetSession: jest.Mock;
    mockFrom: jest.Mock;
  };
};

const { checkIsOnline } = jest.requireMock('../hooks/useNetworkStatus') as {
  checkIsOnline: jest.Mock;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const TRIP_ID = 'trip-uuid-1';
const CONTACT_IDS = ['c-uuid-1', 'c-uuid-2'];
const EVENT_ID = 'event-uuid-abc';
const TOKEN = 'test-bearer-token';
const BACKEND = 'http://localhost:3001';

function mockBackendSOS(overrides: Partial<{ ok: boolean; status: number; notified: number; total: number; eventId: string }> = {}) {
  const { ok = true, status = 200, notified = 2, total = 2, eventId = EVENT_ID } = overrides;
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: jest.fn().mockResolvedValue({ success: ok, eventId, notified, total }),
  });
}

function mockBackendCancel(overrides: Partial<{ ok: boolean; status: number; error?: string }> = {}) {
  const { ok = true, status = 200, error } = overrides;
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: jest.fn().mockResolvedValue(ok ? { success: true } : { error: error ?? 'Not found' }),
  });
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // GPS: permission granted, position in Lagos
  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
  mockLocation.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 6.5244, longitude: 3.3792, accuracy: 15, speed: 0, heading: 0, altitude: null, altitudeAccuracy: null },
    timestamp: Date.now(),
  } as never);

  // Auth: valid session
  sm.mockGetSession.mockResolvedValue({
    data: { session: { access_token: TOKEN } },
  });

  // Network: online
  checkIsOnline.mockResolvedValue(true);

  // Backend: SOS success
  mockBackendSOS();

  // AsyncStorage: empty cache (no pre-cached contacts)
  AsyncStorage.getItem.mockResolvedValue(null);
  AsyncStorage.setItem.mockResolvedValue(undefined);

  // Supabase: trip with 2 contact IDs
  sm.mockSingle.mockResolvedValue({
    data: { contact_ids: CONTACT_IDS },
    error: null,
  });

  // Supabase: 2 resolved contacts
  sm.mockContactsEq.mockResolvedValue({
    data: [
      { id: 'c-uuid-1', name: 'Amina Bello', phone: '+2348012345678' },
      { id: 'c-uuid-2', name: 'Emeka Obi', phone: '+2347098765432' },
    ],
    error: null,
  });

  // Linking: SMS supported
  Linking.canOpenURL.mockResolvedValue(true);
  Linking.openURL.mockResolvedValue(undefined);
});

// ── GPS accuracy ──────────────────────────────────────────────────────────────

describe('GPS accuracy', () => {
  it('requests position at Accuracy.High', async () => {
    await triggerSOS(TRIP_ID, CONTACT_IDS);

    expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.High, // 4
    });
  });

  it('does not use Accuracy.Balanced or Accuracy.Low', async () => {
    await triggerSOS(TRIP_ID, CONTACT_IDS);

    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({ accuracy: Location.Accuracy.Balanced }),
    );
    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({ accuracy: Location.Accuracy.Low }),
    );
  });
});

// ── Internet path (happy) ─────────────────────────────────────────────────────

describe('internet path — happy', () => {
  it('returns { success: true, eventId, notified, total }', async () => {
    const result = await triggerSOS(TRIP_ID, CONTACT_IDS);

    expect(result.success).toBe(true);
    expect(result.eventId).toBe(EVENT_ID);
    expect(result.notified).toBe(2);
    expect(result.total).toBe(2);
  });

  it('POSTs to backend with tripId, lat, lng, contactIds', async () => {
    await triggerSOS(TRIP_ID, CONTACT_IDS);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BACKEND}/api/v1/sos`);
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body as string) as {
      tripId: string; lat: number; lng: number; contactIds: string[];
    };
    expect(body.tripId).toBe(TRIP_ID);
    expect(typeof body.lat).toBe('number');
    expect(typeof body.lng).toBe('number');
    expect(body.contactIds).toEqual(CONTACT_IDS);
  });

  it('passes JWT in Authorization: Bearer header', async () => {
    await triggerSOS(TRIP_ID, CONTACT_IDS);

    const [, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('does not open the SMS app on success', async () => {
    await triggerSOS(TRIP_ID, CONTACT_IDS);

    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});

// ── All contacts notified ─────────────────────────────────────────────────────

describe('all contacts notified', () => {
  it('sends all 3 contactIds to the backend', async () => {
    const threeContacts = ['c-1', 'c-2', 'c-3'];
    mockBackendSOS({ notified: 3, total: 3 });

    const result = await triggerSOS(TRIP_ID, threeContacts);

    expect(result.total).toBe(3);
    const [, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { contactIds: string[] };
    expect(body.contactIds).toHaveLength(3);
    expect(body.contactIds).toEqual(threeContacts);
  });
});

// ── Offline fallback ──────────────────────────────────────────────────────────

describe('offline fallback', () => {
  it('falls back to Linking.openURL sms: when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));

    // Pre-cache contacts so the fallback has phones to send to
    AsyncStorage.getItem.mockResolvedValue(
      JSON.stringify([
        { id: 'c-uuid-1', name: 'Amina', phone: '+2348012345678' },
        { id: 'c-uuid-2', name: 'Emeka', phone: '+2347098765432' },
      ]),
    );

    const result = await triggerSOS(TRIP_ID, CONTACT_IDS);

    expect(result.success).toBe(false);
    expect(result.notified).toBe(0);
    expect(result.total).toBeGreaterThanOrEqual(CONTACT_IDS.length);

    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    const [url] = Linking.openURL.mock.calls[0] as [string];
    expect(url).toMatch(/^sms:/);
  });

  it('fallback SMS URL contains a google maps location link', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    AsyncStorage.getItem.mockResolvedValue(
      JSON.stringify([{ id: 'c-1', name: 'Amina', phone: '+2348012345678' }]),
    );

    await triggerSOS(TRIP_ID, CONTACT_IDS);

    const [url] = Linking.openURL.mock.calls[0] as [string];
    expect(url).toContain('maps.google.com');
  });
});

// ── Rate limit fallback ───────────────────────────────────────────────────────

describe('rate limit fallback', () => {
  it('triggers Linking.openURL SMS when backend returns 429', async () => {
    mockBackendSOS({ ok: false, status: 429 });

    AsyncStorage.getItem.mockResolvedValue(
      JSON.stringify([{ id: 'c-uuid-1', name: 'Amina', phone: '+2348012345678' }]),
    );

    const result = await triggerSOS(TRIP_ID, CONTACT_IDS);

    expect(result.success).toBe(false);
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    const [url] = Linking.openURL.mock.calls[0] as [string];
    expect(url).toMatch(/^sms:/);
  });
});

// ── cancelSOS ─────────────────────────────────────────────────────────────────

describe('cancelSOS', () => {
  it('calls PATCH /api/v1/sos/:id/cancel with correct eventId', async () => {
    mockBackendCancel();

    await cancelSOS(EVENT_ID);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BACKEND}/api/v1/sos/${EVENT_ID}/cancel`);
    expect(options.method).toBe('PATCH');
  });

  it('sends JWT in Authorization: Bearer header', async () => {
    mockBackendCancel();

    await cancelSOS(EVENT_ID);

    const [, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('returns { success: true } on 200', async () => {
    mockBackendCancel({ ok: true, status: 200 });

    const result = await cancelSOS(EVENT_ID);

    expect(result).toEqual({ success: true });
  });

  it('returns { success: false, error } on 404', async () => {
    mockBackendCancel({ ok: false, status: 404, error: 'SOS event not found' });

    const result = await cancelSOS(EVENT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe('SOS event not found');
  });

  it('returns { success: false, error } when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

    const result = await cancelSOS(EVENT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });

  it('returns { success: false, error } when not authenticated', async () => {
    sm.mockGetSession.mockResolvedValue({ data: { session: null } });

    const result = await cancelSOS(EVENT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not authenticated/i);
  });
});

// ── getSOSContacts ────────────────────────────────────────────────────────────

describe('getSOSContacts', () => {
  it('returns contacts for a trip with contact_ids', async () => {
    const contacts = await getSOSContacts(TRIP_ID);

    expect(contacts).toHaveLength(2);
    expect(contacts[0].name).toBe('Amina Bello');
    expect(contacts[0].phone).toBe('+2348012345678');
    expect(contacts[1].name).toBe('Emeka Obi');
  });

  it('returns [] when trip is not found', async () => {
    sm.mockSingle.mockResolvedValue({ data: null, error: { message: 'Not found' } });

    const contacts = await getSOSContacts(TRIP_ID);

    expect(contacts).toEqual([]);
  });

  it('returns [] when trip has empty contact_ids', async () => {
    sm.mockSingle.mockResolvedValue({ data: { contact_ids: [] }, error: null });

    const contacts = await getSOSContacts(TRIP_ID);

    expect(contacts).toEqual([]);
  });

  it('caches contacts to AsyncStorage on success', async () => {
    await getSOSContacts(TRIP_ID);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'HADIN_SOS_CONTACTS_CACHE',
      expect.any(String),
    );
    const [, cachedJson] = AsyncStorage.setItem.mock.calls[0] as [string, string];
    const cached = JSON.parse(cachedJson) as { name: string }[];
    expect(cached[0].name).toBe('Amina Bello');
  });
});

/*
 * ── MANUAL TEST PROCEDURES ──────────────────────────────────────────────────
 *
 * MANUAL TEST: SOS trigger
 * 1. Start a trip with at least 1 contact assigned
 * 2. Tap "Send SOS" once — spinner should appear immediately (no hold required)
 * 3. Verify red banner appears within 3 seconds: "SOS Active — help is on the way"
 * 4. Check backend logs for sos_events INSERT and SMS send attempts
 * 5. Confirm SMS attempted (check AT dashboard or backend logs for statusCode 100)
 * 6. Tap "Cancel SOS" — banner returns to green "Trip active"
 *
 * MANUAL TEST: Offline SOS fallback
 * 1. Enable airplane mode
 * 2. Tap "Send SOS"
 * 3. Native SMS app should open with pre-filled body containing a maps.google.com link
 * 4. Send the message manually to complete the alert
 *
 * MANUAL TEST: End trip
 * 1. Tap "End trip" — confirm dialog appears
 * 2. Confirm — trip status updates to 'completed' in Supabase dashboard
 * 3. HomeScreen returns to idle state
 * 4. No further GPS pings fire after trip ends
 */

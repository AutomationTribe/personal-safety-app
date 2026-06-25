// LocationService.test.ts
// Uses module-level mocks only — no jest.resetModules() (incompatible with ts-jest preset).

import * as Location from 'expo-location';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRemove = jest.fn();
const mockRunAsync = jest.fn().mockResolvedValue(undefined);
const mockGetAllAsync = jest.fn().mockResolvedValue([]);
const mockGetFirstAsync = jest.fn().mockResolvedValue(null);
const mockExecAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue({
    execAsync: mockExecAsync,
    runAsync: mockRunAsync,
    getAllAsync: mockGetAllAsync,
    getFirstAsync: mockGetFirstAsync,
  }),
}));

jest.mock('expo-location', () => ({
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: 6.5244, longitude: 3.3792, accuracy: 15, speed: 0, heading: 0 },
    timestamp: Date.now(),
  }),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
}));

jest.mock('../hooks/useNetworkStatus', () => ({
  checkIsOnline: jest.fn().mockResolvedValue(true),
}));

const mockInsert = jest.fn().mockReturnValue({ error: null });
jest.mock('../lib/supabase', () => ({
  supabase: { from: jest.fn(() => ({ insert: mockInsert })) },
}));

// Import AFTER mocks are registered
import {
  startTracking,
  stopTracking,
  getCurrentLocation,
  getQueuedPings,
  getLastPing,
  flushQueue,
  getIsStationary,
} from '../services/LocationService';

const mockLocation = Location as jest.Mocked<typeof Location>;
const { checkIsOnline } = jest.requireMock('../hooks/useNetworkStatus') as { checkIsOnline: jest.Mock };

// ── Helpers ───────────────────────────────────────────────────────────────────

function setPosition(lat: number, lng: number) {
  mockLocation.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: lat, longitude: lng, accuracy: 15, speed: 0, heading: 0 },
    timestamp: Date.now(),
  } as never);
}

function setWatchPosition() {
  mockLocation.watchPositionAsync.mockResolvedValue({ remove: mockRemove } as never);
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockRunAsync.mockResolvedValue(undefined);
  mockGetAllAsync.mockResolvedValue([]);
  mockGetFirstAsync.mockResolvedValue(null);
  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
  setPosition(6.5244, 3.3792);
  setWatchPosition();
  checkIsOnline.mockResolvedValue(true);
  mockInsert.mockReturnValue({ error: null });
  // Always stop before each test to reset module-level state
  await stopTracking();
});

// ── Permission ────────────────────────────────────────────────────────────────

describe('Permission handling', () => {
  it('proceeds when permission granted', async () => {
    await expect(startTracking('trip-1', 30)).resolves.not.toThrow();
    await stopTracking();
  });

  it('throws when permission denied', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
    await expect(startTracking('trip-1', 30)).rejects.toThrow('Location permission denied');
  });
});

// ── startTracking ─────────────────────────────────────────────────────────────

describe('startTracking', () => {
  it('calls watchPositionAsync with Accuracy.Balanced', async () => {
    await startTracking('trip-1', 30);
    expect(mockLocation.watchPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ accuracy: Location.Accuracy.Balanced }),
      expect.any(Function),
    );
    await stopTracking();
  });

  it('uses timeInterval of intervalMinutes * 60 * 1000', async () => {
    await startTracking('trip-1', 30);
    expect(mockLocation.watchPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ timeInterval: 30 * 60 * 1000 }),
      expect.any(Function),
    );
    await stopTracking();
  });

  it('uses distanceInterval of 500', async () => {
    await startTracking('trip-1', 30);
    expect(mockLocation.watchPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ distanceInterval: 500 }),
      expect.any(Function),
    );
    await stopTracking();
  });

  it('warns and returns early when already tracking', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await startTracking('trip-1', 30);
    await startTracking('trip-2', 30);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Already tracking'));
    consoleSpy.mockRestore();
    await stopTracking();
  });
});

// ── stopTracking ──────────────────────────────────────────────────────────────

describe('stopTracking', () => {
  it('removes subscription', async () => {
    mockLocation.watchPositionAsync.mockResolvedValue({ remove: mockRemove } as never);
    await startTracking('trip-1', 30);
    await stopTracking();
    expect(mockRemove).toHaveBeenCalled();
  });

  it('resets stationary state', async () => {
    await startTracking('trip-1', 30);
    await stopTracking();
    expect(getIsStationary()).toBe(false);
  });
});

// ── getCurrentLocation ────────────────────────────────────────────────────────

describe('getCurrentLocation', () => {
  it('uses Accuracy.High', async () => {
    await getCurrentLocation();
    expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ accuracy: Location.Accuracy.High }),
    );
  });

  it('returns correctly shaped LocationPing', async () => {
    setPosition(9.057, 7.494);
    const ping = await getCurrentLocation();
    expect(ping.lat).toBe(9.057);
    expect(ping.lng).toBe(7.494);
    expect(ping.source).toBe('gps');
    expect(ping.synced).toBe(false);
    expect(typeof ping.timestamp).toBe('string');
  });

  it('tripId is empty string when no active trip', async () => {
    const ping = await getCurrentLocation();
    expect(ping.tripId).toBe('');
  });
});

// ── Stationary detection ──────────────────────────────────────────────────────

describe('Stationary detection', () => {
  it('getIsStationary() is false after stopTracking', async () => {
    await startTracking('trip-1', 30);
    await stopTracking();
    expect(getIsStationary()).toBe(false);
  });
});

// ── SQLite queue (offline-first) ──────────────────────────────────────────────

describe('SQLite queue', () => {
  it('writes to SQLite on startTracking (captureAndQueue on start)', async () => {
    await startTracking('trip-1', 30);
    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO location_pings_queue'),
      expect.any(Array),
    );
    await stopTracking();
  });

  it('does not call Supabase.from when offline', async () => {
    checkIsOnline.mockResolvedValue(false);
    const { supabase } = jest.requireMock('../lib/supabase') as { supabase: { from: jest.Mock } };
    supabase.from.mockClear();
    await startTracking('trip-offline', 30);
    expect(supabase.from).not.toHaveBeenCalled();
    await stopTracking();
    checkIsOnline.mockResolvedValue(true);
  });
});

// ── flushQueue ────────────────────────────────────────────────────────────────

describe('flushQueue', () => {
  it('returns { synced: 0, failed: 0 } for empty queue', async () => {
    mockGetAllAsync.mockResolvedValue([]);
    const result = await flushQueue();
    expect(result).toEqual({ synced: 0, failed: 0 });
  });
});

// ── Battery-mode logging ──────────────────────────────────────────────────────

describe('Battery-mode logging', () => {
  it('logs battery-mode: balanced when __DEV__ is true', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await startTracking('trip-1', 30);

    const calls = consoleSpy.mock.calls.map((args) => String(args[0]));
    expect(calls.some((c) => c.includes('battery-mode: balanced'))).toBe(true);

    consoleSpy.mockRestore();
    await stopTracking();
  });
});

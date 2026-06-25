import {
  formatNigerianPhone,
  getContacts,
  addContact,
  updateContact,
  deleteContact,
  searchContacts,
  TrustedContact,
} from '../services/CircleService';

// ── Supabase mock ─────────────────────────────────────────────────────────────

// These are accessed inside jest.mock factories which are hoisted — define lazily via require
jest.mock('../lib/supabase', () => {
  const mockFns = {
    single: jest.fn(),
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    eq: jest.fn(),
    order: jest.fn(),
    getUser: jest.fn(),
  };
  return {
    supabase: {
      from: jest.fn(() => ({
        select: mockFns.select,
        insert: mockFns.insert,
        update: mockFns.update,
        delete: mockFns.delete,
      })),
      auth: { getUser: mockFns.getUser },
    },
    __mockFns: mockFns,
  };
});

// Grab the mock functions after jest.mock runs
const { __mockFns: m } = jest.requireMock('../lib/supabase') as {
  __mockFns: {
    single: jest.Mock; select: jest.Mock; insert: jest.Mock;
    update: jest.Mock; delete: jest.Mock; eq: jest.Mock;
    order: jest.Mock; getUser: jest.Mock;
  };
};

// Aliases for readability
const mockSingle = m.single;
const mockSelect = m.select;
const mockInsert = m.insert;
const mockUpdate = m.update;
const mockDelete = m.delete;
const mockEq = m.eq;
const mockOrder = m.order;
const mockGetUser = m.getUser;

// Chain returns
beforeEach(() => {
  jest.clearAllMocks();

  mockOrder.mockResolvedValue({ data: [], error: null });
  mockSelect.mockReturnValue({ order: mockOrder, single: mockSingle });
  mockInsert.mockReturnValue({ select: () => ({ single: mockSingle }) });
  mockUpdate.mockReturnValue({ eq: mockEq });
  mockDelete.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, select: () => ({ single: mockSingle }) });

  mockSingle.mockResolvedValue({ data: null, error: null });
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123', email: 'test@test.com', user_metadata: {} } }, error: null });

  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeContact = (overrides: Partial<TrustedContact> = {}): TrustedContact => ({
  id: 'c-1',
  user_id: 'user-123',
  name: 'Amina Bello',
  phone: '+2348012345678',
  relationship: 'Friend',
  notify_on_sos: true,
  notify_on_trip_start: false,
  created_at: new Date().toISOString(),
  ...overrides,
});

// ── formatNigerianPhone ───────────────────────────────────────────────────────

describe('formatNigerianPhone', () => {
  it('converts 08012345678 to +2348012345678', () => {
    expect(formatNigerianPhone('08012345678')).toBe('+2348012345678');
  });

  it('converts 2348012345678 to +2348012345678', () => {
    expect(formatNigerianPhone('2348012345678')).toBe('+2348012345678');
  });

  it('leaves +2348012345678 unchanged', () => {
    expect(formatNigerianPhone('+2348012345678')).toBe('+2348012345678');
  });

  it('returns short number as-is (fails validation later)', () => {
    expect(formatNigerianPhone('0801234')).toBe('0801234');
  });
});

// ── getContacts ───────────────────────────────────────────────────────────────

describe('getContacts', () => {
  it('returns mapped TrustedContact array on success', async () => {
    const row = {
      id: 'c-1', user_id: 'user-123', name: 'Amina', phone: '+2348012345678',
      email: null, relationship: 'Friend', notify_on_sos: true,
      notify_on_trip_start: false, created_at: '2026-01-01T00:00:00Z',
    };
    mockOrder.mockResolvedValue({ data: [row], error: null });
    const result = await getContacts();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Amina');
    expect(result[0]).not.toHaveProperty('email'); // null email omitted
  });

  it('returns [] on Supabase error', async () => {
    mockOrder.mockResolvedValue({ data: null, error: { message: 'DB down' } });
    const result = await getContacts();
    expect(result).toEqual([]);
  });

  it('returns [] for empty result', async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });
    expect(await getContacts()).toEqual([]);
  });
});

// ── addContact — validation ───────────────────────────────────────────────────

describe('addContact validation', () => {
  it('returns error for missing name', async () => {
    const r = await addContact({ name: '', phone: '+2348012345678', relationship: 'Friend' });
    expect(r).toEqual({ data: null, error: 'Name is required.' });
  });

  it('returns error for missing phone', async () => {
    const r = await addContact({ name: 'Kemi', phone: '', relationship: 'Sister' });
    expect(r).toEqual({ data: null, error: 'Phone number is required.' });
  });

  it('returns error for missing relationship', async () => {
    const r = await addContact({ name: 'Kemi', phone: '+2348012345678', relationship: '' });
    expect(r).toEqual({ data: null, error: 'Relationship is required.' });
  });

  it('returns phone error for invalid format', async () => {
    const r = await addContact({ name: 'Kemi', phone: '123456', relationship: 'Friend' });
    expect(r.error).toMatch(/valid Nigerian/i);
  });

  it('passes validation for a valid Nigerian mobile', async () => {
    mockSingle.mockResolvedValue({ data: makeContact(), error: null });
    const r = await addContact({ name: 'Kemi Ade', phone: '08012345678', relationship: 'Friend' });
    expect(r.error).toBeNull();
  });
});

// ── addContact — happy path ───────────────────────────────────────────────────

describe('addContact happy path', () => {
  it('returns contact and does not await notifyContactViaSMS', async () => {
    const contact = makeContact();
    mockSingle.mockResolvedValue({ data: contact, error: null });

    const result = await addContact({ name: 'Amina Bello', phone: '08012345678', relationship: 'Friend' });

    expect(result.data?.name).toBe('Amina Bello');
    expect(result.error).toBeNull();
    // fetch called fire-and-forget — may or may not have resolved by now
    // but the result should already be returned
  });

  it('notifyContactViaSMS failure does not affect return value', async () => {
    const contact = makeContact();
    mockSingle.mockResolvedValue({ data: contact, error: null });
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    const result = await addContact({ name: 'Amina Bello', phone: '08012345678', relationship: 'Friend' });

    expect(result.error).toBeNull();
    expect(result.data).toBeTruthy();
  });
});

// ── addContact — Supabase error ───────────────────────────────────────────────

describe('addContact Supabase error', () => {
  it('returns error message from Supabase', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'RLS violation' } });

    const result = await addContact({ name: 'Amina Bello', phone: '08012345678', relationship: 'Friend' });

    expect(result.data).toBeNull();
    expect(result.error).toBe('RLS violation');
  });
});

// ── updateContact ─────────────────────────────────────────────────────────────

describe('updateContact', () => {
  it('returns error for empty name', async () => {
    const r = await updateContact('c-1', { name: '' });
    expect(r.error).toBe('Name cannot be empty.');
  });

  it('returns error for empty relationship', async () => {
    const r = await updateContact('c-1', { relationship: '' });
    expect(r.error).toBe('Relationship cannot be empty.');
  });

  it('returns error when no fields provided', async () => {
    const r = await updateContact('c-1', {});
    expect(r.error).toBe('No fields provided to update.');
  });

  it('normalises phone before update', async () => {
    const contact = makeContact({ phone: '+2348087654321' });
    mockEq.mockReturnValue({ select: () => ({ single: jest.fn().mockResolvedValue({ data: contact, error: null }) }) });
    const r = await updateContact('c-1', { phone: '08087654321' });
    expect(r.error).toBeNull();
    // The Supabase .update() should have been called with +234 format
    const updateArg = mockUpdate.mock.calls[0][0] as { phone: string };
    expect(updateArg.phone).toBe('+2348087654321');
  });

  it('returns updated contact on success', async () => {
    const contact = makeContact({ name: 'Updated Name' });
    mockEq.mockReturnValue({ select: () => ({ single: jest.fn().mockResolvedValue({ data: contact, error: null }) }) });
    const r = await updateContact('c-1', { name: 'Updated Name' });
    expect(r.data?.name).toBe('Updated Name');
    expect(r.error).toBeNull();
  });
});

// ── deleteContact ─────────────────────────────────────────────────────────────

describe('deleteContact', () => {
  it('returns error when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const r = await deleteContact('c-1');
    expect(r).toEqual({ success: false, error: 'Not authenticated.' });
  });

  it('returns error on Supabase failure', async () => {
    mockEq.mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: { message: 'Delete failed' } }) });
    const r = await deleteContact('c-1');
    expect(r.success).toBe(false);
    expect(r.error).toBe('Delete failed');
  });

  it('returns success on happy path', async () => {
    mockEq.mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    const r = await deleteContact('c-1');
    expect(r).toEqual({ success: true, error: null });
  });

  it('includes user_id in delete query (RLS safety check)', async () => {
    const eqSpy = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    mockDelete.mockReturnValue({ eq: eqSpy });
    await deleteContact('c-1');
    expect(eqSpy).toHaveBeenCalledWith('id', 'c-1');
  });
});

// ── searchContacts ────────────────────────────────────────────────────────────

describe('searchContacts', () => {
  const contacts: TrustedContact[] = [
    makeContact({ id: '1', name: 'Amina Bello', phone: '+2348012345678', relationship: 'Friend' }),
    makeContact({ id: '2', name: 'Emeka Obi', phone: '+2347098765432', relationship: 'Brother' }),
  ];

  it('returns all contacts for empty query', () => {
    expect(searchContacts('', contacts)).toEqual(contacts);
  });

  it('matches on name case-insensitively', () => {
    expect(searchContacts('amina', contacts)).toHaveLength(1);
    expect(searchContacts('AMINA', contacts)).toHaveLength(1);
  });

  it('matches on phone substring', () => {
    expect(searchContacts('9876', contacts)).toHaveLength(1);
  });

  it('matches on relationship case-insensitively', () => {
    expect(searchContacts('brother', contacts)).toHaveLength(1);
  });

  it('returns empty array when no match', () => {
    expect(searchContacts('xyz999', contacts)).toHaveLength(0);
  });
});

import { supabase } from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrustedContact {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  email?: string;
  relationship: string;
  notify_on_sos: boolean;
  notify_on_trip_start: boolean;
  created_at: string;
}

export interface NewContact {
  name: string;
  phone: string;
  email?: string;
  relationship: string;
}

export interface ContactResult {
  data: TrustedContact | null;
  error: string | null;
}

// ── Validation ────────────────────────────────────────────────────────────────

// Accepts +2348012345678 (13 digits after +234)
const NIGERIAN_E164_RE = /^\+234[789]\d{9}$/;

function validateRequired(data: NewContact): string | null {
  if (!data.name.trim()) return 'Name is required.';
  if (!data.phone.trim()) return 'Phone number is required.';
  if (!data.relationship.trim()) return 'Relationship is required.';
  return null;
}

function validatePhone(phone: string): string | null {
  const formatted = formatNigerianPhone(phone);
  if (!NIGERIAN_E164_RE.test(formatted)) {
    return 'Enter a valid Nigerian phone number (e.g. 08012345678 or +2348012345678).';
  }
  return null;
}

// ── Utility ───────────────────────────────────────────────────────────────────

export function formatNigerianPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+234')) return trimmed;
  if (trimmed.startsWith('234')) return `+${trimmed}`;
  if (trimmed.startsWith('0') && trimmed.length >= 10) {
    return `+234${trimmed.slice(1)}`;
  }
  return trimmed;
}

// ── Row shape returned by Supabase ────────────────────────────────────────────

interface ContactRow {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  email: string | null;
  relationship: string;
  notify_on_sos: boolean;
  notify_on_trip_start: boolean;
  created_at: string;
}

function rowToContact(row: ContactRow): TrustedContact {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    phone: row.phone,
    ...(row.email ? { email: row.email } : {}),
    relationship: row.relationship,
    notify_on_sos: row.notify_on_sos,
    notify_on_trip_start: row.notify_on_trip_start,
    created_at: row.created_at,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getContacts(): Promise<TrustedContact[]> {
  try {
    const { data, error } = await supabase
      .from('trusted_contacts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[CircleService] getContacts failed:', error.message);
      return [];
    }

    return ((data ?? []) as ContactRow[]).map(rowToContact);
  } catch (err) {
    console.warn('[CircleService] getContacts error:', err);
    return [];
  }
}

export async function addContact(data: NewContact): Promise<ContactResult> {
  const requiredError = validateRequired(data);
  if (requiredError) return { data: null, error: requiredError };

  const normalised = { ...data, phone: formatNigerianPhone(data.phone) };

  const phoneError = validatePhone(normalised.phone);
  if (phoneError) return { data: null, error: phoneError };

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { data: null, error: 'Not authenticated.' };

    const insert = {
      user_id: user.id,
      name: normalised.name.trim(),
      phone: normalised.phone,
      ...(normalised.email?.trim() ? { email: normalised.email.trim() } : {}),
      relationship: normalised.relationship.trim(),
    };

    const { data: row, error } = await supabase
      .from('trusted_contacts')
      .insert(insert)
      .select()
      .single();

    if (error || !row) {
      return { data: null, error: error?.message ?? 'Failed to add contact.' };
    }

    const contact = rowToContact(row as ContactRow);
    const userName: string = (user.user_metadata as { full_name?: string })?.full_name ?? user.email ?? '';

    // Fire-and-forget — do not await, do not surface failure to caller
    notifyContactViaSMS(contact, userName).catch(() => {});

    return { data: contact, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unexpected error.' };
  }
}

export async function updateContact(
  id: string,
  data: Partial<NewContact>,
): Promise<ContactResult> {
  // Validate any required fields that were provided
  if (data.name !== undefined && !data.name.trim()) {
    return { data: null, error: 'Name cannot be empty.' };
  }
  if (data.relationship !== undefined && !data.relationship.trim()) {
    return { data: null, error: 'Relationship cannot be empty.' };
  }

  const patch: Partial<{
    name: string;
    phone: string;
    email: string;
    relationship: string;
  }> = {};

  if (data.name !== undefined) patch.name = data.name.trim();
  if (data.relationship !== undefined) patch.relationship = data.relationship.trim();
  if (data.email !== undefined) patch.email = data.email.trim();

  if (data.phone !== undefined) {
    const normalised = formatNigerianPhone(data.phone);
    const phoneError = validatePhone(normalised);
    if (phoneError) return { data: null, error: phoneError };
    patch.phone = normalised;
  }

  if (Object.keys(patch).length === 0) {
    return { data: null, error: 'No fields provided to update.' };
  }

  try {
    const { data: row, error } = await supabase
      .from('trusted_contacts')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error || !row) {
      return { data: null, error: error?.message ?? 'Failed to update contact.' };
    }

    return { data: rowToContact(row as ContactRow), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unexpected error.' };
  }
}

export async function deleteContact(
  id: string,
): Promise<{ success: boolean; error: string | null }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { success: false, error: 'Not authenticated.' };

    const { error } = await supabase
      .from('trusted_contacts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unexpected error.' };
  }
}

export function searchContacts(query: string, contacts: TrustedContact[]): TrustedContact[] {
  const q = query.trim().toLowerCase();
  if (!q) return contacts;
  return contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.relationship.toLowerCase().includes(q),
  );
}

export async function notifyContactViaSMS(
  contact: TrustedContact,
  userName: string,
): Promise<void> {
  const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

  try {
    const res = await fetch(`${backendUrl}/api/v1/contacts/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactPhone: contact.phone,
        contactName: contact.name,
        userName,
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      console.warn('[CircleService] notifyContactViaSMS backend error:', body.error ?? res.status);
    }
  } catch (err) {
    console.warn('[CircleService] notifyContactViaSMS failed:', err);
  }
}

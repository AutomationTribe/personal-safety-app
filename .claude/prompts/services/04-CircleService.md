# Prompt: CircleService.ts

## Read first (in this order)
- CLAUDE.md
- mobile/src/lib/supabase.ts
- mobile/src/styles/tokens.ts

## Goal
Build mobile/src/services/CircleService.ts — the ONLY file
that talks to the trusted_contacts Supabase table.

## Types to export
```typescript
export interface TrustedContact {
  id: string
  user_id: string
  name: string
  phone: string
  email?: string
  relationship: string
  notify_on_sos: boolean
  notify_on_trip_start: boolean
  created_at: string
}

export interface NewContact {
  name: string
  phone: string
  email?: string
  relationship: string
}

export interface ContactResult {
  data: TrustedContact | null
  error: string | null
}
```

## Functions to export

### getContacts(): Promise<TrustedContact[]>
- Fetch all contacts for logged-in user
- Order by created_at DESC
- Return [] on any error — never throw

### addContact(data: NewContact): Promise<ContactResult>
- Validate: name (min 2 chars), phone (Nigerian E.164),
  relationship (non-empty)
- Return { data: null, error: 'message' } if validation fails
- Insert into trusted_contacts via Supabase
- On success: call notifyContactViaSMS() — fire and forget,
  never await, never block the return
- Return { data: newContact, error: null } on success

### updateContact(id, data): Promise<ContactResult>
- Patch only the fields provided
- Re-validate any required fields that are present in data
- No SMS on update
- Return { data: updatedContact, error: null } on success

### deleteContact(id): Promise<{ success: boolean; error: string | null }>
- Delete where id = id AND user_id = current user
- Return { success: true, error: null } on success

### searchContacts(query, contacts): Promise<TrustedContact[]>
- Local filter — no DB call
- Case-insensitive match on name, phone, relationship

### notifyContactViaSMS(contact, userName): Promise<void>
- POST to /api/v1/contacts/notify
- Body: { contactPhone, contactName, userName }
- Silent fail — log only, never surface to user
- Fire and forget

### formatNigerianPhone(phone): string
- 08012345678 → +2348012345678
- 2348012345678 → +2348012345678
- +2348012345678 → unchanged

## Rules
- Module pattern — no class
- TypeScript strict, no any
- All Supabase calls from lib/supabase.ts only
- Error shape: { error: string, code: string }

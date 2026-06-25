# Prompt: CircleService unit tests

## Agent
QA Engineer — read .claude/agents/qa-engineer.md first.

## Read before writing
- CLAUDE.md
- mobile/src/services/CircleService.ts
- mobile/src/lib/supabase.ts

## Goal
Write mobile/src/__tests__/CircleService.test.ts

## Test setup
Mock @supabase/supabase-js:
  jest.mock('../lib/supabase', () => ({
    supabase: { from: jest.fn(), auth: { getUser: jest.fn() } }
  }))

Mock fetch globally for notifyContactViaSMS tests.

## Test cases required

### formatNigerianPhone
- 08012345678 → +2348012345678
- 2348012345678 → +2348012345678
- +2348012345678 → +2348012345678 (unchanged)
- 0801234 (too short) → returned as-is, fails validation

### getContacts
- Happy path: returns mapped TrustedContact array
- Supabase error: returns empty array, does not throw
- Empty result: returns empty array

### addContact — validation
- Missing name: returns { data: null, error: 'Name is required.' }
- Missing phone: returns { data: null, error: 'Phone number is required.' }
- Missing relationship: returns { data: null, error: 'Relationship is required.' }
- Invalid phone format: returns phone validation error
- Valid Nigerian mobile: passes validation

### addContact — happy path
- Inserts correctly formatted data to Supabase
- Calls notifyContactViaSMS fire-and-forget (does not await)
- Returns { data: contact, error: null }
- notifyContactViaSMS failure does NOT affect return value

### addContact — Supabase error
- Returns { data: null, error: supabase error message }
- Does not call notifyContactViaSMS

### updateContact
- Empty name returns error
- Empty relationship returns error
- No fields provided returns error
- Valid partial update calls Supabase .update() with only provided fields
- Phone field is normalised before update

### deleteContact
- Not authenticated: returns { success: false, error: 'Not authenticated.' }
- Supabase error: returns { success: false, error: message }
- Happy path: returns { success: true, error: null }
- Verifies user_id is included in the delete query (RLS safety check)

### searchContacts
- Empty query returns all contacts unchanged
- Matches on name (case-insensitive)
- Matches on phone number substring
- Matches on relationship (case-insensitive)
- No match returns empty array

## Rules
- Jest + TypeScript
- No actual Supabase calls — all mocked
- No actual SMS calls — fetch mocked
- Each test in its own describe block
- Use beforeEach to reset mocks between tests
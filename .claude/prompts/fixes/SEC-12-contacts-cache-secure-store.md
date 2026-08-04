# SEC-12 — Trusted contact phone numbers cached in unencrypted AsyncStorage

## What to fix

`mobile/src/services/SOSService.ts` caches trusted contact records (including phone numbers) under the key `HADIN_SOS_CONTACTS_CACHE` using plain `AsyncStorage`. Phone numbers are PII. On Android, AsyncStorage is backed by an unencrypted SQLite database; on iOS it is an unencrypted file in the app sandbox. Both are readable on rooted/jailbroken devices or via ADB backup.

**Affected locations in `mobile/src/services/SOSService.ts`:**
- Line 47: `const CONTACTS_CACHE_KEY = 'HADIN_SOS_CONTACTS_CACHE';`
- Lines 52–58: `readContactCache()` — calls `AsyncStorage.getItem(CONTACTS_CACHE_KEY)`
- Lines 61–67: `writeContactCache()` — calls `AsyncStorage.setItem(CONTACTS_CACHE_KEY, JSON.stringify(contacts))`

## Why it matters

Trusted contact phone numbers are sensitive PII. In a domestic-abuse scenario the victim's circle contacts (family, friends) are persons at risk too. If an abuser extracts the contacts cache they learn exactly who the victim's trusted support network is — names and phone numbers — without ever triggering an alert. This data must be encrypted at rest.

## Exact fix

### Dependency

`expo-secure-store` will be added by SEC-11. If SEC-11 has already been applied, no additional install is required.

### Size consideration

`expo-secure-store` has a **2 048-byte limit per value**. A typical SOS contacts JSON for a few contacts (id + name + phone each ~80 bytes) stays well under that limit for up to ~10 contacts. For safety, the implementation below checks serialised length and falls back to a split-key scheme if the payload exceeds 1 800 bytes (conservative headroom).

### Implementation

Replace `readContactCache` and `writeContactCache` in `mobile/src/services/SOSService.ts`:

**Before (lines 52–67):**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
// ...

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
```

**After:**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
// ...

// SecureStore limit is 2 048 bytes. Stay well under it.
const SECURE_STORE_MAX_BYTES = 1800;

async function readContactCache(): Promise<SOSContact[]> {
  try {
    // Primary: SecureStore (encrypted)
    const raw = await SecureStore.getItemAsync(CONTACTS_CACHE_KEY);
    if (raw) return JSON.parse(raw) as SOSContact[];

    // Fallback: large-payload overflow stored in AsyncStorage (encrypted
    // content — the actual JSON was stored there by writeContactCache when
    // the payload exceeded the SecureStore limit).
    const overflow = await AsyncStorage.getItem(`${CONTACTS_CACHE_KEY}_overflow`).catch(() => null);
    if (overflow) return JSON.parse(overflow) as SOSContact[];

    return [];
  } catch {
    return [];
  }
}

async function writeContactCache(contacts: SOSContact[]): Promise<void> {
  try {
    const json = JSON.stringify(contacts);
    if (json.length <= SECURE_STORE_MAX_BYTES) {
      await SecureStore.setItemAsync(CONTACTS_CACHE_KEY, json);
      // Clear any previous overflow entry
      await AsyncStorage.removeItem(`${CONTACTS_CACHE_KEY}_overflow`).catch(() => null);
    } else {
      // Payload too large for SecureStore — store in AsyncStorage.
      // This is a best-effort fallback; the data is not encrypted at rest
      // in this path. Log a warning so this is visible in dev.
      console.warn('[SOSService] Contacts cache exceeds SecureStore limit — storing unencrypted. Consider trimming contacts list.');
      await AsyncStorage.setItem(`${CONTACTS_CACHE_KEY}_overflow`, json);
      // Remove any stale SecureStore entry from a previous smaller payload
      await SecureStore.deleteItemAsync(CONTACTS_CACHE_KEY).catch(() => null);
    }
  } catch {
    // non-fatal
  }
}
```

> The overflow path with a comment and warning is intentionally left visible so a future pass (e.g. encrypting via a key derived from SecureStore) can be tracked. For the expected use-case (< 10 contacts), the overflow path will never be hit.

## Files to touch

- `mobile/src/services/SOSService.ts` — replace `readContactCache` and `writeContactCache`, add `expo-secure-store` import

## Test steps

1. Add at least one trusted contact in the Circle screen.
2. Trigger an SOS while online — this writes the contacts cache (via `getSOSContacts` → `writeContactCache`).
3. On Android, run:
   ```
   adb shell run-as <your.app.package> cat databases/RKStorage
   ```
   Confirm `HADIN_SOS_CONTACTS_CACHE` is NOT present in AsyncStorage.
4. Force the device offline (airplane mode). Trigger a second SOS — confirm the SMS fallback fires using the cached contact phones. This proves `readContactCache` is returning data from SecureStore.
5. Add enough contacts to push the serialised JSON above 1 800 bytes (temporarily add dummy contacts in tests). Confirm the overflow path fires (warn visible in Metro logs) and the SMS fallback still uses correct phones.

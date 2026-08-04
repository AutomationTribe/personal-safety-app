# SEC-11 — SOS PIN stored in plain text in AsyncStorage

## What to fix

The SOS cancel PIN is stored under the key `HADIN_SOS_PIN` using `AsyncStorage` (unencrypted) in two files. On Android, `AsyncStorage` data sits in a plain SQLite database that is readable via ADB backup or on rooted devices. A malicious actor who gains access to the file can read the PIN and silently cancel a live SOS without the user's consent.

**Affected locations:**

`mobile/src/screens/trip/HomeScreen.tsx`
- Line 55: constant declaration `const SOS_PIN_KEY = 'HADIN_SOS_PIN';`
- Line 311: **read** — `await AsyncStorage.getItem(SOS_PIN_KEY)` (inside `checkSetupSteps`)
- Line 381: **write** — `await AsyncStorage.setItem(SOS_PIN_KEY, next)` (inside `handlePinDigit`)
- Line 680: **read** — `await AsyncStorage.getItem(SOS_PIN_KEY)` (inside `handleCancelPinDigit`)
- Line 702: **delete** — `await AsyncStorage.removeItem(SOS_PIN_KEY)` (inside `handleForgotSOSPin`)

## Why it matters

A rooted device or an ADB backup can expose the SOS PIN in plaintext. An abuser who has momentary physical access to the device can extract the PIN and use it to cancel a real SOS triggered by the victim. This directly undermines the central safety guarantee of the app.

## Exact fix

### Step 1 — Add the dependency (it is NOT already in `mobile/package.json`)

```bash
cd mobile && npx expo install expo-secure-store
```

### Step 2 — Replace the import and all usages in `HomeScreen.tsx`

**Add import** (alongside the existing `AsyncStorage` import at line 24):

```ts
import * as SecureStore from 'expo-secure-store';
```

The existing `AsyncStorage` import must stay — it is still used for `SETUP_GPS_KEY`, `SETUP_AUDIO_KEY`, `USER_MODE_KEY`. Only the SOS PIN key moves to SecureStore.

**Replace all reads, writes, and deletes of `SOS_PIN_KEY`:**

| Location | Before | After |
|---|---|---|
| `checkSetupSteps` (line 311) | `await AsyncStorage.getItem(SOS_PIN_KEY)` | `await SecureStore.getItemAsync(SOS_PIN_KEY)` |
| `handlePinDigit` (line 381) | `await AsyncStorage.setItem(SOS_PIN_KEY, next)` | `await SecureStore.setItemAsync(SOS_PIN_KEY, next)` |
| `handleCancelPinDigit` (line 680) | `await AsyncStorage.getItem(SOS_PIN_KEY)` | `await SecureStore.getItemAsync(SOS_PIN_KEY)` |
| `handleForgotSOSPin` (line 702) | `await AsyncStorage.removeItem(SOS_PIN_KEY)` | `await SecureStore.deleteItemAsync(SOS_PIN_KEY)` |

Each existing `.catch(() => null)` wrapper is fine to keep — SecureStore methods throw on failure the same way AsyncStorage does.

**Full before/after for the four call sites:**

```ts
// checkSetupSteps — before
const pin = await AsyncStorage.getItem(SOS_PIN_KEY).catch(() => null);

// checkSetupSteps — after
const pin = await SecureStore.getItemAsync(SOS_PIN_KEY).catch(() => null);
```

```ts
// handlePinDigit — before
await AsyncStorage.setItem(SOS_PIN_KEY, next).catch(() => null);

// handlePinDigit — after
await SecureStore.setItemAsync(SOS_PIN_KEY, next).catch(() => null);
```

```ts
// handleCancelPinDigit — before
const savedPin = await AsyncStorage.getItem(SOS_PIN_KEY).catch(() => null);

// handleCancelPinDigit — after
const savedPin = await SecureStore.getItemAsync(SOS_PIN_KEY).catch(() => null);
```

```ts
// handleForgotSOSPin — before
await AsyncStorage.removeItem(SOS_PIN_KEY).catch(() => null);

// handleForgotSOSPin — after
await SecureStore.deleteItemAsync(SOS_PIN_KEY).catch(() => null);
```

> **Note on key size:** `expo-secure-store` values are limited to 2 048 bytes. A 4-digit PIN is 4 bytes — well within that limit. No size concern here.

## Files to touch

- `mobile/src/screens/trip/HomeScreen.tsx` — 4 call-site replacements + new import
- `mobile/package.json` — new dependency added by `npx expo install`

## Test steps

1. Run `npx expo install expo-secure-store` and confirm it appears in `mobile/package.json`.
2. Cold-launch the app on a fresh install. Complete the PIN setup step (enter + confirm a PIN). Verify the setup modal dismisses as before.
3. Trigger an SOS. On the cancel sheet, enter the correct PIN — confirm SOS cancels.
4. Enter the wrong PIN — confirm the error message appears and SOS stays active.
5. Use "Forgot PIN?" — confirm the PIN setup modal re-opens.
6. On Android (with Android Studio device manager or a physical device), run:
   ```
   adb shell run-as <your.app.package> cat databases/RKStorage
   ```
   or inspect the AsyncStorage SQLite via DB Browser. Confirm `HADIN_SOS_PIN` does NOT appear there.
7. On iOS, use the Xcode Instruments "File System" snapshot — confirm the PIN is stored in Keychain rather than the app sandbox documents/databases directory.

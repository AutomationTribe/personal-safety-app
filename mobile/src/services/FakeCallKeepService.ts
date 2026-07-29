import { Linking, PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import RNCallKeep from 'react-native-callkeep';
import { navigateToActiveCall, navigateToIncomingCall, navigateHome } from '../navigation/navigationRef';

const BATTERY_PROMPT_SHOWN_KEY = 'HADIN_FAKECALL_BATTERY_PROMPT_SHOWN';

// Maps an in-flight CallKeep call UUID -> the caller name it was displayed
// with, since CallKeep's events only hand back the UUID.
const pendingCalls = new Map<string, string>();

let didSetup = false;
let listenersRegistered = false;

const options = {
  ios: {
    appName: 'Hadin',
    supportsVideo: false,
    maximumCallGroups: '1',
    maximumCallsPerCallGroup: '1',
  },
  android: {
    alertTitle: 'Permissions required',
    alertDescription: 'Hadin needs phone account access to show a realistic incoming call for the Fake Call safety feature.',
    cancelButton: 'Cancel',
    okButton: 'OK',
    imageName: 'ic_launcher',
    additionalPermissions: [] as string[],
    foregroundService: {
      channelId: 'app.hadin.mobile.callkeep',
      channelName: 'Hadin fake call',
      notificationTitle: 'Hadin is displaying a fake call',
    },
    selfManaged: true,
  },
};

// Real UUID-ness doesn't matter here — CallKeep just needs a unique string
// per call, and the README's warning about "valid uuid" is specifically an
// iOS CallKit requirement, not a cryptographic one.
function generateCallUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function setupCallKeep(): Promise<boolean> {
  if (didSetup) return true;
  try {
    await RNCallKeep.setup(options);
    RNCallKeep.setAvailable(true);
    didSetup = true;
    return true;
  } catch (err) {
    console.warn('[FakeCallKeep] setup failed — falling back to in-app call screens', err);
    return false;
  }
}

/**
 * Best-effort permission/setup pass, run when the user schedules a fake
 * call (not just once at app boot) so a freshly-denied permission gets
 * caught before the countdown finishes rather than silently failing.
 *
 * READ_PHONE_STATE is only enforced pre-Android 10 (react-native-callkeep's
 * own manifest caps it at maxSdkVersion 29) but requesting it is harmless
 * on newer versions. Notification permission matters because CallKeep's
 * Android foreground-service notification (and the call's own heads-up
 * surface) won't post without it. Battery-optimization exemption isn't a
 * standard requestable permission — some OEMs (Transsion/Tecno, Infinix,
 * Xiaomi, etc.) aggressively kill backgrounded self-managed telecom
 * connections unless the app is excluded, so we deep-link the user to that
 * settings screen once.
 */
export async function ensureFakeCallPermissions(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE);
    } catch {
      // Not fatal — only required pre-Android 10.
    }

    const { status } = await Notifications.getPermissionsAsync().catch(() => ({ status: 'undetermined' as const }));
    if (status !== 'granted') {
      await Notifications.requestPermissionsAsync().catch(() => null);
    }

    const alreadyPrompted = await AsyncStorage.getItem(BATTERY_PROMPT_SHOWN_KEY).catch(() => null);
    if (!alreadyPrompted) {
      await AsyncStorage.setItem(BATTERY_PROMPT_SHOWN_KEY, 'done').catch(() => null);
      try {
        // Opens the general "Battery optimization" list — there's no public
        // API to pre-target this app's row without a data URI, which
        // Linking.sendIntent doesn't support, so the user picks Hadin
        // manually and sets it to "Don't optimize" / "No restrictions".
        Linking.sendIntent?.('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
      } catch {
        // Non-fatal — some OEM ROMs don't expose this action.
      }
    }
  }

  await setupCallKeep();
}

/**
 * Registers the CallKeep event listeners once for the lifetime of the app.
 * Navigation happens via `navigationRef` since these events can fire
 * outside of any mounted screen's React tree.
 */
export function registerCallKeepListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  // Android self-managed connections get NO automatic system UI — the OS
  // fires this event and the app is expected to render its own incoming
  // call screen in response. Without this listener the call rings silently
  // at the telecom layer with nothing ever shown to the user.
  RNCallKeep.addEventListener('showIncomingCallUi', ({ callUUID, name }) => {
    const callerName = pendingCalls.get(callUUID) ?? name ?? 'Unknown';
    navigateToIncomingCall(callerName, callUUID);
  });

  RNCallKeep.addEventListener('answerCall', ({ callUUID }) => {
    try {
      if (Platform.OS === 'android') {
        RNCallKeep.setCurrentCallActive(callUUID);
        RNCallKeep.backToForeground();
      }
    } catch {
      // Non-fatal — the call still proceeds in-app either way.
    }
    const callerName = pendingCalls.get(callUUID) ?? 'Unknown';
    navigateToActiveCall(callerName, callUUID);
  });

  RNCallKeep.addEventListener('endCall', ({ callUUID }) => {
    pendingCalls.delete(callUUID);
    navigateHome();
  });
}

/**
 * Displays a real native incoming-call screen (Android ConnectionService /
 * iOS CallKit) for the given caller name. Returns the call UUID on success,
 * or null if native CallKeep isn't available (e.g. setup/permission
 * failure) — callers should fall back to the in-app IncomingCallScreen.
 */
export async function displayIncomingFakeCall(callerName: string): Promise<string | null> {
  await ensureFakeCallPermissions();
  if (!didSetup) return null;

  // Clears out any call left stuck ringing from a previous attempt (e.g. one
  // whose UI never rendered before this listener existed) — otherwise the
  // telecom stack can silently ignore a new incoming call while a stale one
  // is still "active".
  try {
    await RNCallKeep.endAllCalls();
  } catch {
    // Nothing to clear, or method unsupported on this platform — fine.
  }

  const uuid = generateCallUUID();
  try {
    RNCallKeep.displayIncomingCall(uuid, callerName, callerName, 'generic', false);
    pendingCalls.set(uuid, callerName);
    return uuid;
  } catch (err) {
    console.warn('[FakeCallKeep] displayIncomingCall failed', err);
    return null;
  }
}

export function answerFakeCall(callUUID: string): void {
  try {
    RNCallKeep.answerIncomingCall(callUUID);
  } catch {
    // Ignored — the manual ActiveCall navigation still proceeds.
  }
}

export function rejectFakeCall(callUUID: string): void {
  pendingCalls.delete(callUUID);
  try {
    RNCallKeep.rejectCall(callUUID);
  } catch {
    // Already ended
  }
}

export function endFakeCall(callUUID: string): void {
  pendingCalls.delete(callUUID);
  try {
    RNCallKeep.endCall(callUUID);
  } catch {
    // Already ended
  }
}

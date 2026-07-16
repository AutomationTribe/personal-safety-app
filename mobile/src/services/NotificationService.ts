import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

let _handlerSet = false;
let _permissionRequested = false;

// Local notifications only (no push token / FCM registration — Always
// Online's pause/resume alerts are device-local events, nothing server-side
// needs to send them). Shows the banner even while the app is foregrounded,
// since that's exactly when a battery-triggered pause happens.
function ensureHandler(): void {
  if (_handlerSet) return;
  _handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensurePermission(): Promise<boolean> {
  ensureHandler();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('tracking', {
      name: 'Tracking status',
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => null);
  }
  if (_permissionRequested) {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  }
  _permissionRequested = true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * "Hadin tracking paused — low battery. Open the app to resume." Never
 * throws — a failed/denied notification just means the user finds out when
 * they next open the app and see the "Tracking paused" banner instead.
 */
export async function notifyTrackingPaused(): Promise<void> {
  try {
    const granted = await ensurePermission();
    if (!granted) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Hadin tracking paused',
        body: 'Tracking paused — low battery. Open the app to resume.',
      },
      trigger: null,
    });
  } catch {
    // non-fatal
  }
}

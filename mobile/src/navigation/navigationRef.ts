import { createNavigationContainerRef } from '@react-navigation/native';
import { AppStackParamList } from './AppNavigator';

// Lets code outside the React tree (native CallKeep event callbacks) drive
// navigation — those events can fire while no screen owns a `useNavigation()`
// instance, e.g. right as the app is brought to foreground.
export const navigationRef = createNavigationContainerRef<AppStackParamList>();

export function navigateToActiveCall(callerName: string, callUUID: string): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('ActiveCall', { callerName, callUUID });
  }
}

export function navigateToIncomingCall(callerName: string, callUUID: string): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('IncomingCall', { callerName, callUUID });
  }
}

export function navigateHome(): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Home');
  }
}

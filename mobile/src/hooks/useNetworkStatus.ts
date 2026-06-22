import { useEffect, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export interface NetworkStatus {
  isOnline: boolean;
  isWifi: boolean;
  connectionType: string;
}

function toNetworkStatus(state: NetInfoState): NetworkStatus {
  return {
    isOnline: state.isConnected === true && state.isInternetReachable !== false,
    isWifi: state.type === 'wifi',
    connectionType: state.type,
  };
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: true,
    isWifi: false,
    connectionType: 'unknown',
  });

  useEffect(() => {
    // Fetch current state immediately on mount
    NetInfo.fetch().then((state) => setStatus(toNetworkStatus(state)));

    // Subscribe to subsequent changes
    const unsubscribe = NetInfo.addEventListener((state) => {
      setStatus(toNetworkStatus(state));
    });

    return unsubscribe;
  }, []);

  return status;
}

// For use inside services and async functions — not tied to a component lifecycle
export async function checkIsOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
}

import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import AppSplashScreen from '../components/AppSplashScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import HomeScreen from '../screens/trip/HomeScreen';
import CircleScreen from '../screens/circle/CircleScreen';
import RoutesScreen from '../screens/routes/RoutesScreen';
import TripDetailScreen from '../screens/routes/TripDetailScreen';
import SOSDetailScreen from '../screens/sos/SOSDetailScreen';
import IncomingCallScreen from '../screens/fakecall/IncomingCallScreen';
import ActiveCallScreen from '../screens/fakecall/ActiveCallScreen';
import { registerCallKeepListeners } from '../services/FakeCallKeepService';
import { navigationRef } from './navigationRef';
import SubscriptionScreen from '../screens/subscription/SubscriptionScreen';
import DirectPaymentScreen from '../screens/subscription/DirectPaymentScreen';
import TrialOfferScreen from '../screens/subscription/TrialOfferScreen';
import SuccessScreen from '../screens/subscription/SuccessScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';
import PhoneCaptureScreen from '../screens/auth/PhoneCaptureScreen';

export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

export type AppStackParamList = {
  Home: undefined;
  Circle: { openAddModal?: boolean } | undefined;
  Routes: undefined;
  TripDetail: { tripId: string };
  SOSDetail: { sosId: string };
  IncomingCall: { callerName: string; callUUID?: string };
  ActiveCall: { callerName: string; callUUID?: string };
  Subscription: undefined;
  DirectPayment: { plan: 'basic' | 'elite' };
  TrialOffer: undefined;
  Success: { type: 'subscriber' | 'trial' };
  Settings: undefined;
  PhoneCapture: undefined;
};

const AuthStackNav = createNativeStackNavigator<AuthStackParamList>();
const AppStackNav = createNativeStackNavigator<AppStackParamList>();

const AuthStack = () => (
  <AuthStackNav.Navigator screenOptions={{ headerShown: false }}>
    <AuthStackNav.Screen name="Login" component={LoginScreen} />
    <AuthStackNav.Screen name="Signup" component={SignupScreen} />
  </AuthStackNav.Navigator>
);

type AppStackProps = { initialRoute: keyof AppStackParamList };

const AppStack = ({ initialRoute }: AppStackProps) => {
  // Registered once for the app's lifetime — CallKeep's native answer/end
  // events can fire outside any mounted screen, so navigation for them goes
  // through `navigationRef` rather than a screen-bound useNavigation().
  useEffect(() => {
    registerCallKeepListeners();
  }, []);

  return (
  <AppStackNav.Navigator
    screenOptions={{ headerShown: false }}
    initialRouteName={initialRoute}
  >
    <AppStackNav.Screen name="Home" component={HomeScreen} />
    <AppStackNav.Screen name="Circle" component={CircleScreen} />
    <AppStackNav.Screen name="Routes" component={RoutesScreen} />
    <AppStackNav.Screen name="TripDetail" component={TripDetailScreen} />
    <AppStackNav.Screen name="SOSDetail" component={SOSDetailScreen} />
    <AppStackNav.Screen
      name="IncomingCall"
      component={IncomingCallScreen}
      options={{ headerShown: false, gestureEnabled: false }}
    />
    <AppStackNav.Screen
      name="ActiveCall"
      component={ActiveCallScreen}
      options={{ headerShown: false, gestureEnabled: false }}
    />
    <AppStackNav.Screen name="Subscription" component={SubscriptionScreen} />
    <AppStackNav.Screen name="DirectPayment" component={DirectPaymentScreen} />
    <AppStackNav.Screen name="TrialOffer" component={TrialOfferScreen} />
    <AppStackNav.Screen name="Success" component={SuccessScreen} />
    <AppStackNav.Screen name="Settings" component={SettingsScreen} />
    <AppStackNav.Screen name="PhoneCapture" component={PhoneCaptureScreen} />
  </AppStackNav.Navigator>
  );
};

interface ProfileRow {
  subscription_status: string;
  trial_end: string | null;
  phone: string | null;
}

async function resolveInitialRoute(userId: string): Promise<keyof AppStackParamList> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('subscription_status, trial_end, phone')
      .eq('id', userId)
      .single();

    // No profile row — email/password new user (profile created by payment flow).
    if (!data) return 'Subscription';

    const profile = data as ProfileRow;
    const { subscription_status, trial_end, phone } = profile;

    if (subscription_status === 'active') return 'Home';

    if (subscription_status === 'trial') {
      const expired = trial_end ? new Date(trial_end) < new Date() : true;
      return expired ? 'Subscription' : 'Home';
    }

    // Free + no phone = new Google user who hasn't captured their phone yet.
    if (subscription_status === 'free' && !phone) return 'PhoneCapture';

    // Explicitly 'free' with phone → show subscription gate
    if (subscription_status === 'free') return 'Subscription';

    // Any other value (null, unexpected) → let the user in rather than looping
    return 'Home';
  } catch {
    return 'Home';
  }
}

const MIN_SPLASH_MS = 2500;

const AppNavigator = () => {
  const [authReady, setAuthReady] = useState(false);
  const [minSplashElapsed, setMinSplashElapsed] = useState(false);
  const [sessionExists, setSessionExists] = useState(false);
  const [initialRoute, setInitialRoute] = useState<keyof AppStackParamList>('Home');

  useEffect(() => {
    const timer = setTimeout(() => setMinSplashElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        if (session) {
          const route = await resolveInitialRoute(session.user.id);
          setInitialRoute(route);
          setSessionExists(true);
        } else {
          setSessionExists(false);
        }
      })
      .catch(() => {
        setSessionExists(false);
      })
      .finally(() => {
        setAuthReady(true);
      });

    let subscription: { unsubscribe: () => void } | null = null;
    try {
      ({ data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session) {
          const route = await resolveInitialRoute(session.user.id);
          setInitialRoute(route);
          setSessionExists(true);
        } else {
          setSessionExists(false);
        }
      }));
    } catch {
      // Supabase not yet configured — auth state changes unavailable
    }

    return () => subscription?.unsubscribe();
  }, []);

  if (!authReady || !minSplashElapsed) {
    return <AppSplashScreen />;
  }

  return (
    <NavigationContainer ref={navigationRef}>
      {sessionExists ? <AppStack initialRoute={initialRoute} /> : <AuthStack />}
    </NavigationContainer>
  );
};

export default AppNavigator;

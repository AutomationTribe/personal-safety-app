import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { supabase } from '../lib/supabase';
import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import HomeScreen from '../screens/trip/HomeScreen';
import CircleScreen from '../screens/circle/CircleScreen';
import RoutesScreen from '../screens/routes/RoutesScreen';
import TripDetailScreen from '../screens/routes/TripDetailScreen';
import SubscriptionScreen from '../screens/subscription/SubscriptionScreen';
import DirectPaymentScreen from '../screens/subscription/DirectPaymentScreen';
import TrialOfferScreen from '../screens/subscription/TrialOfferScreen';
import SuccessScreen from '../screens/subscription/SuccessScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';
import { colors } from '../styles/tokens';

export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

export type AppStackParamList = {
  Home: undefined;
  Circle: undefined;
  Routes: undefined;
  TripDetail: { tripId: string };
  Subscription: undefined;
  DirectPayment: undefined;
  TrialOffer: undefined;
  Success: { type: 'subscriber' | 'trial' };
  Settings: undefined;
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

const AppStack = ({ initialRoute }: AppStackProps) => (
  <AppStackNav.Navigator
    screenOptions={{ headerShown: false }}
    initialRouteName={initialRoute}
  >
    <AppStackNav.Screen name="Home" component={HomeScreen} />
    <AppStackNav.Screen name="Circle" component={CircleScreen} />
    <AppStackNav.Screen name="Routes" component={RoutesScreen} />
    <AppStackNav.Screen name="TripDetail" component={TripDetailScreen} />
    <AppStackNav.Screen name="Subscription" component={SubscriptionScreen} />
    <AppStackNav.Screen name="DirectPayment" component={DirectPaymentScreen} />
    <AppStackNav.Screen name="TrialOffer" component={TrialOfferScreen} />
    <AppStackNav.Screen name="Success" component={SuccessScreen} />
    <AppStackNav.Screen name="Settings" component={SettingsScreen} />
  </AppStackNav.Navigator>
);

interface ProfileRow {
  subscription_status: string;
  trial_end: string | null;
}

async function resolveInitialRoute(userId: string): Promise<keyof AppStackParamList> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('subscription_status, trial_end')
      .eq('id', userId)
      .single();

    // No profile row means the upsert in the payment screen hasn't run yet
    // or the row was never created. Treat as needing subscription.
    // BUT if the user previously had a session (re-login), default to Home
    // to avoid a broken loop — the payment screens use upsert now so this
    // case should only occur for brand-new unsubscribed users.
    if (!data) return 'Subscription';

    const profile = data as ProfileRow;
    const { subscription_status, trial_end } = profile;

    if (subscription_status === 'active') return 'Home';

    if (subscription_status === 'trial') {
      const expired = trial_end ? new Date(trial_end) < new Date() : true;
      return expired ? 'Subscription' : 'Home';
    }

    // Explicitly 'free' → show subscription gate
    if (subscription_status === 'free') return 'Subscription';

    // Any other value (null, unexpected) → let the user in rather than looping
    return 'Home';
  } catch {
    return 'Home';
  }
}

const AppNavigator = () => {
  const [initializing, setInitializing] = useState(true);
  const [sessionExists, setSessionExists] = useState(false);
  const [initialRoute, setInitialRoute] = useState<keyof AppStackParamList>('Home');

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
        setInitializing(false);
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

  if (initializing) {
    return (
      <View style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
      }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {sessionExists ? <AppStack initialRoute={initialRoute} /> : <AuthStack />}
    </NavigationContainer>
  );
};

export default AppNavigator;

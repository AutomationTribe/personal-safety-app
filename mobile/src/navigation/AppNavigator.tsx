import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { supabase } from '../lib/supabase';
import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import HomeScreen from '../screens/trip/HomeScreen';
import { colors } from '../styles/tokens';

export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

export type AppStackParamList = {
  Home: undefined;
};

const AuthStackNav = createNativeStackNavigator<AuthStackParamList>();
const AppStackNav = createNativeStackNavigator<AppStackParamList>();

const AuthStack = () => (
  <AuthStackNav.Navigator screenOptions={{ headerShown: false }}>
    <AuthStackNav.Screen name="Login" component={LoginScreen} />
    <AuthStackNav.Screen name="Signup" component={SignupScreen} />
  </AuthStackNav.Navigator>
);

const AppStack = () => (
  <AppStackNav.Navigator screenOptions={{ headerShown: false }}>
    <AppStackNav.Screen name="Home" component={HomeScreen} />
  </AppStackNav.Navigator>
);

const AppNavigator = () => {
  const [initializing, setInitializing] = useState(true);
  const [sessionExists, setSessionExists] = useState(false);

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSessionExists(!!session);
      })
      .catch(() => {
        setSessionExists(false);
      })
      .finally(() => {
        setInitializing(false);
      });

    let subscription: { unsubscribe: () => void } | null = null;
    try {
      ({ data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setSessionExists(!!session);
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
      {sessionExists ? <AppStack /> : <AuthStack />}
    </NavigationContainer>
  );
};

export default AppNavigator;

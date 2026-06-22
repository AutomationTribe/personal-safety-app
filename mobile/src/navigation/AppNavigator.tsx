import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  Circle: undefined;
};

const PlaceholderCircleScreen = () => {
  const insets = useSafeAreaInsets();
  return (
    <View style={[placeholderStyles.root, { paddingTop: insets.top }]}>
      <View style={placeholderStyles.header}>
        <Text style={placeholderStyles.title}>Your circle</Text>
        <Text style={placeholderStyles.subtitle}>Your trusted contacts</Text>
      </View>
      <View style={placeholderStyles.body}>
        <Text style={placeholderStyles.emoji}>👥</Text>
        <Text style={placeholderStyles.emptyTitle}>Your circle is empty</Text>
        <Text style={placeholderStyles.emptyBody}>
          Add the people who travel with you in spirit.
        </Text>
      </View>
    </View>
  );
};

const placeholderStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F3EF' },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  title: { fontSize: 20, fontWeight: '800', color: '#1A1A1A', letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: '#8F8D85', marginTop: 2 },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emoji: { fontSize: 40, marginBottom: 16 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A1A', textAlign: 'center', marginBottom: 8 },
  emptyBody: { fontSize: 14, color: '#8F8D85', textAlign: 'center', lineHeight: 22 },
});

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
    <AppStackNav.Screen name="Circle" component={PlaceholderCircleScreen} />
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

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { signInWithGoogle } from '../../services/GoogleAuthService';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AuthStackParamList } from '../../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Login'>;
};

const LAST_IDENTIFIER_KEY = 'HADIN_LAST_SIGNIN_ID';

const LoginScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const identifierRef = useRef<TextInput | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    identifierRef.current?.focus();
    AsyncStorage.getItem(LAST_IDENTIFIER_KEY)
      .then((saved) => { if (saved) setIdentifier(saved); })
      .catch(() => {});
  }, []);

  const isPhone = (value: string) => /^\+?\d[\d\s\-]{6,}$/.test(value.trim());

  const handleSubmit = async () => {
    if (!identifier.trim() || !password) {
      setAuthError('Please enter your email or phone number and password.');
      return;
    }
    setLoading(true);
    setAuthError('');

    const credentials = isPhone(identifier)
      ? { phone: identifier.trim(), password }
      : { email: identifier.trim(), password };

    const { error } = await supabase.auth.signInWithPassword(credentials);
    setLoading(false);

    if (error) {
      setAuthError('Incorrect email/phone or password.');
      return;
    }

    AsyncStorage.setItem(LAST_IDENTIFIER_KEY, identifier.trim()).catch(() => {});
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setAuthError('');
    const result = await signInWithGoogle();
    setGoogleLoading(false);

    if (!result.success) {
      if (result.error === 'cancelled' || result.error === 'in_progress') return;
      setAuthError(result.error);
      return;
    }
    // AppNavigator's onAuthStateChange handles routing automatically.
    // New users (isNewUser = true) get subscription_status = 'free' → Subscription screen.
    // Returning users are routed by resolveInitialRoute based on their status.
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Green header ── */}
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          {navigation.canGoBack() && (
            <Pressable style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={12}>
              <Feather name="arrow-left" size={20} color="rgba(255,255,255,0.75)" />
            </Pressable>
          )}
          <View style={styles.brandRow}>
            <Feather name="shield" size={16} color={colors.brand.mid} />
            <Text style={styles.brandName}>Hadin</Text>
          </View>
          <Text style={styles.headerEyebrow}>Welcome back</Text>
          <Text style={styles.headerHeadline}>Your circle{'\n'}missed you.</Text>
          <Text style={styles.headerSub}>
            Sign in to continue your journey with the people you love.
          </Text>
        </View>

        {/* ── Body ── */}
        <View style={styles.body}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email or phone</Text>
            <View style={styles.inputWrapper}>
              <Feather name="user" size={16} color="#9C9A92" style={styles.leftIcon} />
              <TextInput
                ref={identifierRef}
                style={styles.input}
                value={identifier}
                onChangeText={setIdentifier}
                editable={!loading}
                placeholder="you@email.com or +234…"
                placeholderTextColor="#C5C3BB"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Password</Text>
            <View style={styles.inputWrapper}>
              <Feather name="lock" size={16} color="#9C9A92" style={styles.leftIcon} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                editable={!loading}
                placeholder="Your password"
                placeholderTextColor="#C5C3BB"
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color="#9C9A92" />
              </Pressable>
            </View>
          </View>

          <View style={styles.forgotRow}>
            <Pressable
              onPress={() => Alert.alert('Coming soon', 'Password reset will be available soon.')}
              disabled={loading}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>
          </View>

          {authError ? <Text style={styles.errorText}>{authError}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.button, pressed && !loading && styles.buttonPressed]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.googleBtn,
              (googleLoading || loading) && styles.googleBtnDisabled,
              pressed && !googleLoading && !loading && styles.pressed,
            ]}
            onPress={handleGoogleSignIn}
            disabled={googleLoading || loading}
          >
            {googleLoading ? (
              <ActivityIndicator color={colors.brand.primary} size="small" />
            ) : (
              <View style={styles.googleIcon}>
                <Text style={styles.googleIconText}>G</Text>
              </View>
            )}
            <Text style={styles.googleBtnText}>Continue with Google</Text>
          </Pressable>

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>New to Hadin? </Text>
            <Pressable onPress={() => navigation.navigate('Signup')} disabled={loading}>
              <Text style={styles.switchLink}>Create an account</Text>
            </Pressable>
          </View>

          <Text style={styles.tagline}>Peace of mind, always on.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand.bgSurface },
  container: { flexGrow: 1, paddingBottom: spacing.gap32 },

  // ── Header ──
  header: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.gap32,
  },
  backBtn: { marginBottom: spacing.gap16 },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.gap20,
  },
  brandName: {
    color: colors.white,
    fontSize: fontSizes.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  headerEyebrow: {
    fontSize: fontSizes.caption,
    fontWeight: '600',
    color: colors.brand.mid,
    letterSpacing: 0.4,
    marginBottom: spacing.gap8,
  },
  headerHeadline: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.white,
    lineHeight: 40,
    marginBottom: spacing.gap12,
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: fontSizes.caption,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 20,
  },

  // ── Body ──
  body: {
    backgroundColor: colors.brand.bgSurface,
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.gap24,
  },
  inputGroup: { marginBottom: spacing.gap16 },
  inputLabel: {
    fontSize: fontSizes.caption,
    fontWeight: '600',
    color: colors.brand.textSecondary,
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: spacing.inputHeight,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.12)',
    borderRadius: spacing.inputRadius,
    paddingHorizontal: spacing.gap16,
    backgroundColor: colors.white,
  },
  leftIcon: { marginRight: spacing.gap12 },
  input: {
    flex: 1,
    color: colors.brand.textPrimary,
    fontSize: fontSizes.body,
    height: '100%',
  },
  forgotRow: { alignItems: 'flex-end', marginBottom: spacing.gap20 },
  forgotText: {
    color: colors.brand.primary,
    fontSize: fontSizes.caption,
    fontWeight: '600',
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSizes.caption,
    marginBottom: spacing.gap16,
  },
  button: {
    height: spacing.buttonHeight,
    borderRadius: spacing.borderRadius,
    backgroundColor: colors.brand.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.gap16,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    color: colors.white,
    fontSize: fontSizes.button,
    fontWeight: '700',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.gap16,
  },
  dividerLine: { flex: 1, height: 0.5, backgroundColor: 'rgba(0,0,0,0.1)' },
  dividerText: {
    marginHorizontal: spacing.gap12,
    color: colors.brand.textSecondary,
    fontSize: fontSizes.caption,
  },
  googleBtn: {
    height: spacing.buttonHeight,
    borderRadius: 11,
    borderWidth: 0.5,
    borderColor: '#EEECe6',
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: spacing.gap24,
  },
  googleBtnDisabled: { opacity: 0.6 },
  googleIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EA4335',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '700',
  },
  googleBtnText: {
    color: colors.brand.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  pressed: { opacity: 0.8 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.gap24,
  },
  switchText: { color: colors.brand.textSecondary, fontSize: fontSizes.body },
  switchLink: {
    color: colors.brand.primary,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },
  tagline: {
    textAlign: 'center',
    fontSize: fontSizes.caption,
    color: colors.brand.textSecondary,
    fontStyle: 'italic',
  },
});

export default LoginScreen;

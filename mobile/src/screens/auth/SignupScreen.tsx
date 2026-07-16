import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { signInWithGoogle } from '../../services/GoogleAuthService';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';
import { colors } from '../../styles/tokens';
import { AuthStackParamList } from '../../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Signup'>;
};

const PHONE_DIGITS_REGEX = /^\d{10}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Accepts 10-digit Nigerian number (with or without leading 0 / +234 prefix).
// Always returns E.164: +234XXXXXXXXXX
function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('234') && digits.length === 13) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+234${digits.slice(1)}`;
  if (digits.length === 10) return `+234${digits}`;
  return `+234${digits}`;
}

function extractLocalDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('234')) return digits.slice(3);
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}

const SignupScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();

  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [touched, setTouched] = useState({
    phone: false,
    email: false,
    password: false,
  });

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [serverError, setServerError] = useState('');
  const [isDuplicate, setIsDuplicate] = useState(false);

  const localDigits = extractLocalDigits(phone);
  const e164Phone = toE164(phone);

  const errors = {
    phone: !phone.trim()
      ? 'Phone number is required'
      : !PHONE_DIGITS_REGEX.test(localDigits)
      ? 'Enter a valid 10-digit Nigerian number'
      : '',
    email: !email.trim()
      ? 'Email address is required'
      : !EMAIL_REGEX.test(email.trim())
      ? 'Enter a valid email address'
      : '',
    password: password.length < 8
      ? 'Must be at least 8 characters'
      : !/[^A-Za-z0-9]/.test(password)
      ? 'Must include a symbol'
      : '',
  };

  const formValid = !errors.phone && !errors.email && !errors.password;

  const blur = (field: keyof typeof touched) =>
    setTouched((p) => ({ ...p, [field]: true }));

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setServerError('');
    setIsDuplicate(false);
    const result = await signInWithGoogle();
    setGoogleLoading(false);

    if (!result.success) {
      // User cancelled or sign-in already in progress — silent
      if (result.error === 'cancelled' || result.error === 'in_progress') return;
      setServerError(result.error);
      return;
    }
    // AppNavigator's onAuthStateChange fires automatically on session creation.
    // New users have subscription_status = 'free' → routed to Subscription.
    // Returning users are routed by resolveInitialRoute based on their status.
  };

  const handleSubmit = async () => {
    setServerError('');
    setIsDuplicate(false);
    setTouched({ phone: true, email: true, password: true });
    if (!formValid) return;

    setLoading(true);

    // Check phone uniqueness before creating the auth user
    const { data: phoneExists, error: phoneCheckError } = await supabase
      .rpc('phone_already_registered', { p_phone: e164Phone });

    if (phoneCheckError) {
      console.warn('[Signup] phone check error:', phoneCheckError.message);
      // Non-fatal — proceed with signup; DB unique constraint is the final guard
    } else if (phoneExists) {
      setServerError('This phone number is already linked to an account.');
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          phone: e164Phone,
          email: email.trim(),
        },
      },
    });

    setLoading(false);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
        setIsDuplicate(true);
      } else if (msg.includes('email signups are disabled')) {
        setServerError('Email sign-up is currently disabled. Please contact support.');
      } else if (msg.includes('rate limit') || msg.includes('too many')) {
        setServerError('Too many attempts. Please wait a moment and try again.');
      } else {
        console.error('[Signup] signUp error:', error.message);
        setServerError('Unable to create your account right now. Please try again.');
      }
      return;
    }

    // Supabase v2: duplicate email returns a user with an empty identities array
    if (data.user?.identities?.length === 0) {
      setIsDuplicate(true);
      return;
    }

    // Fire welcome SMS — non-blocking, never shown to user if it fails
    const token = data.session?.access_token;
    if (token && BACKEND_URL) {
      fetch(`${BACKEND_URL}/api/v1/auth/welcome-sms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch((err: unknown) => {
        console.warn('[Signup] welcome SMS fire failed:', err instanceof Error ? err.message : err);
      });
    }

    // Auth state change in AppNavigator will detect the new session
    // and route to Subscription screen based on subscription_status = 'free'
  };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.keyboardRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            styles.container,
            { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 22 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.hero}>
          <Image
            source={require('../../../assets/hadin-login-logo.png')}
            style={styles.logoMark}
            resizeMode="contain"
          />
          <Text style={styles.heroTitle}>Create Your Account</Text>
          <Text style={styles.heroSubtitle}>Join Hadin to stay protected wherever you go.</Text>
        </View>

        <View style={styles.card}>
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
                <Image
                  source={require('../../../assets/google-g-logo.png')}
                  style={styles.googleLogo}
                  resizeMode="contain"
                />
              </View>
            )}
            <Text style={styles.googleBtnText}>Sign up with Google</Text>
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Phone Number</Text>
            <View style={[styles.inputWrapper, touched.phone && errors.phone ? styles.inputError : null]}>
              <Feather name="phone" size={15} color="#9CA3AF" style={styles.leftIcon} />
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                onBlur={() => blur('phone')}
                editable={!loading}
                placeholder="+1 (555) 000-0000"
                placeholderTextColor="#A7ADB7"
                keyboardType="phone-pad"
                returnKeyType="next"
                autoCorrect={false}
              />
            </View>
            {touched.phone && errors.phone ? <Text style={styles.errorText}>{errors.phone}</Text> : null}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email Address</Text>
            <View style={[styles.inputWrapper, touched.email && errors.email ? styles.inputError : null]}>
              <Feather name="mail" size={15} color="#9CA3AF" style={styles.leftIcon} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                onBlur={() => blur('email')}
                editable={!loading}
                placeholder="name@company.com"
                placeholderTextColor="#A7ADB7"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
            {touched.email && errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Password</Text>
            <View style={[styles.inputWrapper, touched.password && errors.password ? styles.inputError : null]}>
              <Feather name="lock" size={15} color="#9CA3AF" style={styles.leftIcon} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                onBlur={() => blur('password')}
                editable={!loading}
                placeholder="********"
                placeholderTextColor="#A7ADB7"
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8} style={styles.eyeBtn}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color="#9C9A92" />
              </Pressable>
            </View>
            {touched.password && errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
            <Text style={styles.passwordHint}>Must be at least 8 characters with a symbol.</Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.button, pressed && !loading && styles.buttonPressed]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.buttonText}>Sign Up</Text>
                <Feather name="arrow-right" size={17} color="#fff" />
              </>
            )}
          </Pressable>

          {isDuplicate ? (
            <View style={styles.serverErrorBox}>
              <Feather name="alert-circle" size={14} color={colors.danger} />
              <Text style={styles.serverErrorText}>
                An account with this phone number or email already exists.
              </Text>
            </View>
          ) : serverError ? (
            <View style={styles.serverErrorBox}>
              <Feather name="alert-circle" size={14} color={colors.danger} />
              <Text style={styles.serverErrorText}>{serverError}</Text>
            </View>
          ) : null}

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Already have an account? </Text>
            <Pressable onPress={() => navigation.navigate('Login')} disabled={loading}>
              <Text style={styles.switchLink}>Log In</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.termsText}>
          By signing up, you agree to Hadin's{' '}
          <Text style={styles.termsLink}>Terms of Service</Text>
          {' '}and{' '}
          <Text style={styles.termsLink}>Privacy Policy</Text>
          {'. We use encryption to ensure your personal safety data remains private and secure.'}
        </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F7F8FC',
  },
  keyboardRoot: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 4,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 22,
  },
  logoMark: {
    width: 42,
    height: 42,
    marginBottom: 14,
  },
  heroTitle: {
    color: '#060B16',
    fontSize: 21,
    fontWeight: '800',
    marginBottom: 5,
  },
  heroSubtitle: {
    color: '#374151',
    fontSize: 12,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DEE3EA',
    paddingHorizontal: 16,
    paddingTop: 15,
    paddingBottom: 18,
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 1,
  },
  googleBtn: {
    height: 31,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#D7DCE3',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 17,
  },
  googleIcon: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleLogo: {
    width: 14,
    height: 14,
  },
  googleBtnText: {
    color: '#111827',
    fontSize: 9,
    fontWeight: '700',
  },
  googleBtnDisabled: { opacity: 0.6 },
  pressed: { opacity: 0.8 },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#D6DAE1',
  },
  dividerText: {
    marginHorizontal: 12,
    color: '#6B7280',
    fontSize: 8,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 11,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#5B21B6',
    marginBottom: 5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 31,
    borderRadius: 5,
    paddingHorizontal: 12,
    backgroundColor: '#ECEEF1',
  },
  inputError: {
    borderColor: colors.danger,
    borderWidth: 1,
    backgroundColor: '#fff',
  },
  leftIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: '#0F172A',
    fontSize: 13,
    height: '100%',
    padding: 0,
  },
  eyeBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 10,
    marginTop: 4,
  },
  passwordHint: {
    color: '#4B5563',
    fontSize: 8,
    marginTop: 4,
  },
  button: {
    height: 34,
    borderRadius: 5,
    backgroundColor: '#4B00B5',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 15,
    marginBottom: 20,
    shadowColor: '#4B00B5',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 3,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  serverErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  serverErrorText: {
    flex: 1,
    color: colors.danger,
    fontSize: 11,
    lineHeight: 16,
  },
  signInLink: {
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  switchText: {
    color: '#4B5563',
    fontSize: 12,
  },
  switchLink: {
    color: '#5B21B6',
    fontSize: 12,
    fontWeight: '700',
  },
  termsText: {
    textAlign: 'center',
    fontSize: 8,
    color: '#B5BBC5',
    lineHeight: 12,
    marginHorizontal: 22,
    marginTop: 25,
  },
  termsLink: {
    color: '#8E96A3',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});

export default SignupScreen;

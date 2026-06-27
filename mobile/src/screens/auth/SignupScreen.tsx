import React, { useState } from 'react';
import {
  ActivityIndicator,
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
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AuthStackParamList } from '../../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Signup'>;
};

const NIGERIAN_E164 = /^\+234[789]\d{9}$/;

function formatNigerianPhone(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('+234')) return t;
  if (t.startsWith('234')) return `+${t}`;
  if (t.startsWith('0') && t.length >= 10) return `+234${t.slice(1)}`;
  return t;
}

function passwordStrength(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

const STRENGTH_COLORS = ['#E53E3E', '#DD6B20', '#D69E2E', '#38A169'];
const STRENGTH_LABELS = ['Weak', 'Fair', 'Good', 'Strong'];

const SignupScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [touched, setTouched] = useState({
    fullName: false,
    phone: false,
    password: false,
  });

  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const formattedPhone = formatNigerianPhone(phone);

  const errors = {
    fullName: !fullName.trim()
      ? 'Full name is required'
      : fullName.trim().length < 2
      ? 'Must be at least 2 characters'
      : '',
    phone: !phone.trim()
      ? 'Phone number is required'
      : !NIGERIAN_E164.test(formattedPhone)
      ? 'Enter a valid Nigerian number (e.g. 08012345678)'
      : '',
    // Password is optional — only validate length if the user has typed something
    password: password.length > 0 && password.length < 8
      ? 'Must be at least 8 characters'
      : '',
  };

  const formValid = !errors.fullName && !errors.phone && !errors.password;

  const blur = (field: keyof typeof touched) =>
    setTouched((p) => ({ ...p, [field]: true }));

  const handleGoogleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    if (error) setServerError(error.message);
  };

  const handleSubmit = async () => {
    // Always clear previous server error before re-validating
    setServerError('');
    setTouched({ fullName: true, phone: true, password: true });
    if (!formValid) return;

    setLoading(true);

    // Use entered email, or derive one from the phone number.
    // The derived domain must be a valid TLD so Supabase accepts it.
    const effectiveEmail = email.trim() || `${formattedPhone.replace('+', '')}@hadin-user.com`;
    // If no password provided, generate a secure one — the user can reset it later via email.
    const effectivePassword = password || `${Math.random().toString(36).slice(-10)}A1!`;

    const { error } = await supabase.auth.signUp({
      email: effectiveEmail,
      password: effectivePassword,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: formattedPhone,
          ...(email.trim() ? { email: email.trim() } : {}),
        },
      },
    });

    setLoading(false);

    if (error) {
      setServerError(error.message || 'Unable to create account. Please try again.');
      return;
    }
    // Auth state change in AppNavigator will detect the new session
    // and route to Subscription screen based on subscription_status = 'free'
  };

  const strength = passwordStrength(password);

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
          <View style={styles.brandRow}>
            <Feather name="shield" size={16} color={colors.brand.mid} />
            <Text style={styles.brandName}>hadin.</Text>
          </View>
          <Text style={styles.headerHeadline}>Your circle,{'\n'}always close.</Text>
          <Text style={styles.headerSub}>
            Stay connected to the people who matter, wherever you are.
          </Text>
        </View>

        {/* ── Body ── */}
        <View style={styles.body}>
          {/* Google */}
          <Pressable
            style={({ pressed }) => [styles.googleBtn, pressed && styles.pressed]}
            onPress={handleGoogleSignIn}
            disabled={loading}
          >
            <View style={styles.googleIcon}>
              <Text style={styles.googleIconText}>G</Text>
            </View>
            <Text style={styles.googleBtnText}>Continue with Google</Text>
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Full name */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Full name</Text>
            <View style={[styles.inputWrapper, touched.fullName && errors.fullName ? styles.inputError : null]}>
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                onBlur={() => blur('fullName')}
                editable={!loading}
                placeholder="Your full name"
                placeholderTextColor="#C5C3BB"
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>
            {touched.fullName && errors.fullName ? <Text style={styles.errorText}>{errors.fullName}</Text> : null}
          </View>

          {/* Phone */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Phone number</Text>
            <View style={[styles.inputWrapper, touched.phone && errors.phone ? styles.inputError : null]}>
              <View style={styles.prefixBadge}>
                <Text style={styles.prefixText}>+234</Text>
              </View>
              <TextInput
                style={[styles.input, styles.inputWithPrefix]}
                value={phone}
                onChangeText={setPhone}
                onBlur={() => blur('phone')}
                editable={!loading}
                placeholder="08012345678"
                placeholderTextColor="#C5C3BB"
                keyboardType="phone-pad"
                returnKeyType="next"
                autoCorrect={false}
              />
            </View>
            {touched.phone && errors.phone ? <Text style={styles.errorText}>{errors.phone}</Text> : null}
          </View>

          {/* Email (optional) */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>
              Email address <Text style={styles.optionalLabel}>(optional)</Text>
            </Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                editable={!loading}
                placeholder="your@email.com"
                placeholderTextColor="#C5C3BB"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Password</Text>
            <View style={[styles.inputWrapper, touched.password && errors.password ? styles.inputError : null]}>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                onBlur={() => blur('password')}
                editable={!loading}
                placeholder="Min. 8 characters"
                placeholderTextColor="#C5C3BB"
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color="#9C9A92" />
              </Pressable>
            </View>
            {touched.password && errors.password ? (
              <Text style={styles.errorText}>{errors.password}</Text>
            ) : null}
            {password.length > 0 && (
              <View style={styles.strengthRow}>
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={[
                      styles.strengthBar,
                      { backgroundColor: i < strength ? STRENGTH_COLORS[strength - 1] : '#E2E0D8' },
                    ]}
                  />
                ))}
                <Text style={[styles.strengthLabel, { color: strength > 0 ? STRENGTH_COLORS[strength - 1] : '#9C9A92' }]}>
                  {strength > 0 ? STRENGTH_LABELS[strength - 1] : ''}
                </Text>
              </View>
            )}
          </View>

          {/* Submit */}
          <Pressable
            style={({ pressed }) => [styles.button, pressed && !loading && styles.buttonPressed]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Continue →</Text>
            )}
          </Pressable>

          {serverError ? (
            <View style={styles.serverErrorBox}>
              <Feather name="alert-circle" size={14} color={colors.danger} />
              <Text style={styles.serverErrorText}>{serverError}</Text>
            </View>
          ) : null}

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Already have an account? </Text>
            <Pressable onPress={() => navigation.navigate('Login')} disabled={loading}>
              <Text style={styles.switchLink}>Sign in</Text>
            </Pressable>
          </View>

          <Text style={styles.termsText}>
            By continuing, you agree to Hadin's{' '}
            <Text style={styles.termsLink}>Terms of Service</Text>
            {' '}and{' '}
            <Text style={styles.termsLink}>Privacy Policy</Text>.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand.bgSurface },
  container: { flexGrow: 1, paddingBottom: spacing.gap32 },

  header: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.gap24,
  },
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
  headerHeadline: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.white,
    lineHeight: 36,
    marginBottom: spacing.gap12,
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: fontSizes.caption,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 20,
  },

  body: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.gap24,
  },

  serverErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 12,
    marginBottom: spacing.gap16,
  },
  serverErrorText: {
    flex: 1,
    color: colors.danger,
    fontSize: fontSizes.caption,
    lineHeight: 18,
  },

  googleBtn: {
    height: spacing.buttonHeight,
    borderRadius: spacing.borderRadius,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: spacing.gap16,
  },
  googleIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#EA4335',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  googleBtnText: {
    color: colors.brand.textPrimary,
    fontSize: fontSizes.body,
    fontWeight: '600',
  },
  pressed: { opacity: 0.8 },

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

  inputGroup: { marginBottom: spacing.gap16 },
  inputLabel: {
    fontSize: fontSizes.caption,
    fontWeight: '600',
    color: colors.brand.textSecondary,
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  optionalLabel: { fontWeight: '400', color: '#B0AFA8' },
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
  inputError: { borderColor: colors.danger, borderWidth: 1 },
  input: {
    flex: 1,
    color: colors.brand.textPrimary,
    fontSize: fontSizes.body,
    height: '100%',
  },
  inputWithPrefix: { marginLeft: 8 },
  prefixBadge: {
    backgroundColor: colors.brand.light,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  prefixText: {
    fontSize: fontSizes.caption,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSizes.caption,
    marginTop: 4,
  },

  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },
  strengthLabel: {
    fontSize: fontSizes.small,
    fontWeight: '600',
    marginLeft: 4,
    minWidth: 36,
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

  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.gap16,
  },
  switchText: { color: colors.brand.textSecondary, fontSize: fontSizes.body },
  switchLink: {
    color: colors.brand.primary,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },

  termsText: {
    textAlign: 'center',
    fontSize: fontSizes.small,
    color: colors.brand.textSecondary,
    lineHeight: 18,
  },
  termsLink: { color: colors.brand.primary, fontWeight: '600' },
});

export default SignupScreen;

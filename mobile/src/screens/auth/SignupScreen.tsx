import React, { useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AuthStackParamList } from '../../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Signup'>;
};

// 0–4 score from password complexity
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
  const [showStep2, setShowStep2] = useState(false);

  // Step 1
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Step 2
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [touched1, setTouched1] = useState({ fullName: false, email: false });
  const [touched2, setTouched2] = useState({ password: false, confirmPassword: false });
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const errors1 = {
    fullName: !fullName.trim()
      ? 'Full name is required'
      : fullName.trim().length < 2
      ? 'Must be at least 2 characters'
      : '',
    email: !email.trim()
      ? 'Email is required'
      : !emailValid
      ? 'Enter a valid email address'
      : '',
  };

  const errors2 = {
    password: !password
      ? 'Password is required'
      : password.length < 8
      ? 'Must be at least 8 characters'
      : '',
    confirmPassword: !confirmPassword
      ? 'Please confirm your password'
      : confirmPassword !== password
      ? 'Passwords do not match'
      : '',
  };

  const step1Valid = !errors1.fullName && !errors1.email;
  const step2Valid = !errors2.password && !errors2.confirmPassword;

  const blur1 = (field: keyof typeof touched1) =>
    setTouched1((p) => ({ ...p, [field]: true }));
  const blur2 = (field: keyof typeof touched2) =>
    setTouched2((p) => ({ ...p, [field]: true }));

  const handleContinue = () => {
    if (!step1Valid) {
      setTouched1({ fullName: true, email: true });
      return;
    }
    setShowStep2(true);
  };

  const handleSubmit = async () => {
    if (!step2Valid) {
      setTouched2({ password: true, confirmPassword: true });
      return;
    }
    setLoading(true);
    setServerError('');

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        },
      },
    });
    setLoading(false);

    if (error) {
      setServerError(error.message || 'Unable to create account. Please try again.');
      return;
    }

    Alert.alert(
      'Check your email',
      `We sent a confirmation link to ${email.trim()}. Click it to activate your account.`,
      [{ text: 'OK', onPress: () => navigation.navigate('Login') }],
    );
  };

  const strength = passwordStrength(password);

  // ── Step indicator ────────────────────────────────────────────────────────────
  const StepIndicator = () => (
    <View style={styles.stepRow}>
      <View style={styles.stepDotActive} />
      <View style={styles.stepLine} />
      <View style={showStep2 ? styles.stepDotActive : styles.stepDotInactive} />
    </View>
  );

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
          {showStep2 ? (
            <Pressable style={styles.backBtn} onPress={() => setShowStep2(false)} hitSlop={12}>
              <Feather name="arrow-left" size={20} color="rgba(255,255,255,0.75)" />
            </Pressable>
          ) : (
            navigation.canGoBack() && (
              <Pressable style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={12}>
                <Feather name="arrow-left" size={20} color="rgba(255,255,255,0.75)" />
              </Pressable>
            )
          )}
          <View style={styles.brandRow}>
            <Feather name="shield" size={16} color={colors.brand.mid} />
            <Text style={styles.brandName}>Hadin</Text>
          </View>
          <Text style={styles.headerEyebrow}>
            {showStep2 ? 'Step 2 of 2' : 'Welcome'}
          </Text>
          <Text style={styles.headerHeadline}>
            {showStep2 ? 'Secure your{"\n"}account.' : 'Never travel{"\n"}alone again.'}
          </Text>
          <Text style={styles.headerSub}>
            {showStep2
              ? 'Choose a strong password to protect your journey data.'
              : 'Create your account and bring your circle along for every journey.'}
          </Text>
          <StepIndicator />
        </View>

        {/* ── Body ── */}
        <View style={styles.body}>
          {serverError ? <Text style={styles.serverError}>{serverError}</Text> : null}

          {!showStep2 ? (
            /* ── Step 1 ── */
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Full name</Text>
                <View style={[styles.inputWrapper, touched1.fullName && errors1.fullName ? styles.inputError : null]}>
                  <TextInput
                    style={styles.input}
                    value={fullName}
                    onChangeText={setFullName}
                    onBlur={() => blur1('fullName')}
                    editable={!loading}
                    placeholder="Your full name"
                    placeholderTextColor="#C5C3BB"
                    autoCapitalize="words"
                    returnKeyType="next"
                  />
                </View>
                {touched1.fullName && errors1.fullName ? <Text style={styles.errorText}>{errors1.fullName}</Text> : null}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email</Text>
                <View style={[styles.inputWrapper, touched1.email && errors1.email ? styles.inputError : null]}>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    onBlur={() => blur1('email')}
                    editable={!loading}
                    placeholder="you@email.com"
                    placeholderTextColor="#C5C3BB"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                  />
                </View>
                {touched1.email && errors1.email ? <Text style={styles.errorText}>{errors1.email}</Text> : null}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>
                  Phone <Text style={styles.optionalLabel}>(optional)</Text>
                </Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                    editable={!loading}
                    placeholder="+234 — for your circle to reach you"
                    placeholderTextColor="#C5C3BB"
                    keyboardType="phone-pad"
                    returnKeyType="next"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or sign up with</Text>
                <View style={styles.dividerLine} />
              </View>

              <Pressable
                style={styles.socialButton}
                onPress={() => Alert.alert('Coming soon', 'Google sign-in will be available soon.')}
              >
                <Text style={styles.socialButtonText}>Continue with Google</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                onPress={handleContinue}
                disabled={loading}
              >
                <Text style={styles.buttonText}>Continue  →</Text>
              </Pressable>

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
            </>
          ) : (
            /* ── Step 2 ── */
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Password</Text>
                <View style={[styles.inputWrapper, touched2.password && errors2.password ? styles.inputError : null]}>
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    onBlur={() => blur2('password')}
                    editable={!loading}
                    placeholder="Min. 8 characters"
                    placeholderTextColor="#C5C3BB"
                    secureTextEntry={!showPassword}
                    returnKeyType="next"
                  />
                  <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                    <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color="#9C9A92" />
                  </Pressable>
                </View>
                {touched2.password && errors2.password ? (
                  <Text style={styles.errorText}>{errors2.password}</Text>
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

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Confirm password</Text>
                <View style={[styles.inputWrapper, touched2.confirmPassword && errors2.confirmPassword ? styles.inputError : null]}>
                  <TextInput
                    style={styles.input}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    onBlur={() => blur2('confirmPassword')}
                    editable={!loading}
                    placeholder="Re-enter your password"
                    placeholderTextColor="#C5C3BB"
                    secureTextEntry={!showConfirm}
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                  <Pressable onPress={() => setShowConfirm((v) => !v)} hitSlop={8}>
                    <Feather name={showConfirm ? 'eye-off' : 'eye'} size={16} color="#9C9A92" />
                  </Pressable>
                </View>
                {touched2.confirmPassword && errors2.confirmPassword ? (
                  <Text style={styles.errorText}>{errors2.confirmPassword}</Text>
                ) : null}
              </View>

              <View style={styles.infoNote}>
                <Feather name="info" size={14} color={colors.brand.primary} style={styles.infoIcon} />
                <Text style={styles.infoNoteText}>
                  Your password protects your location history and your circle's contact details. Use something only you know.
                </Text>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  !step2Valid && styles.buttonDisabled,
                  pressed && step2Valid && !loading && styles.buttonPressed,
                ]}
                onPress={handleSubmit}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Create my account</Text>
                )}
              </Pressable>

              <View style={styles.switchRow}>
                <Text style={styles.switchText}>Already have an account? </Text>
                <Pressable onPress={() => navigation.navigate('Login')} disabled={loading}>
                  <Text style={styles.switchLink}>Sign in</Text>
                </Pressable>
              </View>
            </>
          )}
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
    paddingBottom: spacing.gap24,
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
    marginBottom: spacing.gap20,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepDotActive: {
    width: 20,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.white,
  },
  stepDotInactive: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  stepLine: {
    width: 8,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },

  // ── Body ──
  body: {
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
  errorText: {
    color: colors.danger,
    fontSize: fontSizes.caption,
    marginTop: 4,
  },
  serverError: {
    color: colors.danger,
    fontSize: fontSizes.caption,
    marginBottom: spacing.gap16,
    textAlign: 'center',
  },

  // Strength
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  strengthLabel: {
    fontSize: fontSizes.small,
    fontWeight: '600',
    marginLeft: 4,
    minWidth: 36,
  },

  // Info note
  infoNote: {
    flexDirection: 'row',
    backgroundColor: colors.brand.light,
    borderRadius: spacing.borderRadius,
    padding: spacing.gap12,
    marginBottom: spacing.gap20,
    gap: spacing.gap8,
    borderWidth: 0.5,
    borderColor: colors.brand.border,
  },
  infoIcon: { marginTop: 1 },
  infoNoteText: {
    flex: 1,
    fontSize: fontSizes.caption,
    color: colors.brand.primary,
    lineHeight: 19,
  },

  // Buttons
  button: {
    height: spacing.buttonHeight,
    borderRadius: spacing.borderRadius,
    backgroundColor: colors.brand.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.gap16,
  },
  buttonDisabled: { opacity: 0.45 },
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
  socialButton: {
    height: spacing.buttonHeight,
    borderRadius: spacing.borderRadius,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.white,
    marginBottom: spacing.gap16,
  },
  socialButtonText: {
    color: colors.brand.textPrimary,
    fontSize: fontSizes.body,
    fontWeight: '600',
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
  termsLink: {
    color: colors.brand.primary,
    fontWeight: '600',
  },
});

export default SignupScreen;

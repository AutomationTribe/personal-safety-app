import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
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
import { colors } from '../../styles/tokens';
import { AuthStackParamList } from '../../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Login'>;
};

const LAST_IDENTIFIER_KEY = 'HADIN_LAST_SIGNIN_ID';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LoginScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const identifierRef = useRef<TextInput | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // ── Password reset sheet state ──
  const [showResetSheet, setShowResetSheet] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetEmailError, setResetEmailError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [resetKeyboardHeight, setResetKeyboardHeight] = useState(0);

  // Modal's statusBarTranslucent breaks Android's adjustResize, so the reset
  // sheet has to shift itself up manually instead of relying on
  // KeyboardAvoidingView/adjustResize inside the Modal.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) =>
      setResetKeyboardHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setResetKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    identifierRef.current?.focus();
    AsyncStorage.getItem(LAST_IDENTIFIER_KEY)
      .then((saved) => { if (saved) setIdentifier(saved); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
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
  };

  // ── Reset sheet handlers ──

  const startCooldown = () => {
    setResetCooldown(30);
    cooldownRef.current = setInterval(() => {
      setResetCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleCloseResetSheet = () => {
    if (resetLoading) return;
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setShowResetSheet(false);
    setResetEmail('');
    setResetEmailError('');
    setResetSent(false);
    setResetLoading(false);
    setResetCooldown(0);
  };

  const handleResetEmailChange = (text: string) => {
    setResetEmail(text);
    if (text.trim() === '') {
      setResetEmailError('');
    } else if (!EMAIL_REGEX.test(text.trim())) {
      setResetEmailError('Enter a valid email address.');
    } else {
      setResetEmailError('');
    }
  };

  const handleSendReset = async () => {
    const trimmed = resetEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(trimmed)) {
      setResetEmailError('Enter a valid email address.');
      return;
    }
    setResetLoading(true);
    // TODO: Add /api/v1/auth/check-email endpoint to backend
    // to enable the user-not-found error state without leaking
    // which emails are registered.
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: 'hadinapp://reset-password',
    });
    setResetLoading(false);
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('rate') || msg.includes('too many')) {
        setResetEmailError('Too many attempts. Try again in a few minutes.');
      } else {
        setResetEmailError('Something went wrong. Please try again.');
      }
      return;
    }
    setResetSent(true);
    startCooldown();
  };

  const handleResend = async () => {
    if (resetCooldown > 0 || resetLoading) return;
    const trimmed = resetEmail.trim().toLowerCase();
    setResetLoading(true);
    await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: 'hadinapp://reset-password',
    });
    setResetLoading(false);
    startCooldown();
  };

  // ── Derived reset sheet state ──
  const resetEmailIsEmpty = resetEmail.trim().length === 0;
  const resetEmailIsValid = EMAIL_REGEX.test(resetEmail.trim());
  const resetHasError = resetEmailError !== '';
  const resetCanSubmit = resetEmailIsValid && !resetLoading;

  return (
    <ImageBackground
      source={require('../../../assets/login-gradient-bg.png')}
      style={styles.root}
      resizeMode="cover"
    >
      <KeyboardAvoidingView
        style={styles.keyboardRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 },
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
          <Text style={styles.heroTitle}>Welcome Back</Text>
          <Text style={styles.heroSubtitle}>Secure access to your safety network.</Text>
        </View>

        {/* ── Card ── */}
        <View style={styles.card}>
          <View style={styles.cardBody}>

            {/* Google button */}
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
                <>
                  <View style={styles.googleIcon}>
                    <Image
                      source={require('../../../assets/google-g-logo.png')}
                      style={styles.googleLogo}
                      resizeMode="contain"
                    />
                  </View>
                  <Text style={styles.googleBtnText}>Login with Google</Text>
                </>
              )}
            </Pressable>

            {/* Divider */}
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Error banner */}
            {authError ? (
              <View style={styles.errorBanner}>
                <Feather name="alert-circle" size={14} color={colors.danger} />
                <Text style={styles.errorBannerText}>{authError}</Text>
              </View>
            ) : null}

            {/* Account Identity field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Email or Phone Number</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  ref={identifierRef}
                  style={styles.input}
                  value={identifier}
                  onChangeText={setIdentifier}
                  editable={!loading}
                  placeholder="Enter your email or phone"
                  placeholderTextColor="#B4B2A9"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>
            </View>

            {/* Password field */}
            <View style={styles.fieldGroup}>
              <View style={styles.securityKeyRow}>
                <Text style={styles.fieldLabelInline}>Password</Text>
                <Pressable onPress={() => setShowResetSheet(true)} disabled={loading}>
                  <Text style={styles.recoveryLink}>Forgot Password?</Text>
                </Pressable>
              </View>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  editable={!loading}
                  placeholder="********"
                  placeholderTextColor="#B4B2A9"
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8} style={styles.eyeBtn}>
                  <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color="#94A3B8" />
                </Pressable>
              </View>
            </View>

            {/* CTA button */}
            <Pressable
              style={({ pressed }) => [
                styles.ctaBtn,
                pressed && !loading && styles.ctaBtnPressed,
              ]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.ctaBtnText}>Log In</Text>
                  <Feather name="arrow-right" size={16} color="#fff" />
                </>
              )}
            </Pressable>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account?</Text>
          <Pressable onPress={() => navigation.navigate('Signup')} disabled={loading}>
            <Text style={styles.footerLink}> Sign Up</Text>
          </Pressable>
        </View>
        </ScrollView>

        {/* ── Password Reset Sheet ── */}
        <Modal
          visible={showResetSheet}
          transparent
          animationType="slide"
          onRequestClose={handleCloseResetSheet}
          statusBarTranslucent
        >
        <View style={rs.overlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={handleCloseResetSheet} />

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[rs.kav, Platform.OS === 'android' && { marginBottom: resetKeyboardHeight }]}
          >
            <View style={rs.sheet}>
              <View style={rs.handle} />

              <View style={[
                rs.iconWrap,
                resetHasError ? rs.iconWrapRed : resetSent ? rs.iconWrapGreen : rs.iconWrapBrand,
              ]}>
                <Feather
                  name={resetSent ? 'check-circle' : 'lock'}
                  size={24}
                  color={resetHasError ? '#C0392B' : resetSent ? '#1A6B4A' : '#4B0082'}
                />
              </View>

              <Text style={rs.title}>
                {resetSent ? 'Check your email' : 'Reset your password'}
              </Text>

              {resetSent ? (
                <>
                  <Text style={rs.subtitle}>
                    {'We\'ve sent a password reset link to '}
                    <Text style={rs.subtitleEmail}>{resetEmail.trim().toLowerCase()}</Text>
                    {'. It expires in 15 minutes.'}
                  </Text>

                  <View style={rs.sentStrip}>
                    <Feather name="send" size={20} color="#1A6B4A" />
                    <View style={rs.sentStripText}>
                      <Text style={rs.sentTitle}>Reset link sent</Text>
                      <Text style={rs.sentSub}>Check your inbox and spam folder</Text>
                    </View>
                  </View>

                  <View style={rs.btnGroup}>
                    <Pressable style={rs.btnPrimary} onPress={handleCloseResetSheet}>
                      <Text style={rs.btnPrimaryTxt}>Back to sign in</Text>
                    </Pressable>
                    <Pressable
                      style={[rs.btnSecondary, resetCooldown > 0 && rs.btnSecondaryDisabled]}
                      onPress={handleResend}
                      disabled={resetCooldown > 0 || resetLoading}
                    >
                      <Text style={[rs.btnSecondaryTxt, resetCooldown > 0 && rs.btnSecondaryTxtDisabled]}>
                        {resetCooldown > 0 ? `Resend in ${resetCooldown}s` : 'Resend email'}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={rs.subtitle}>
                    Enter the email address on your account and we'll send you a reset link.
                  </Text>

                  <View style={rs.inputWrap}>
                    <Text style={rs.inputLbl}>Email address</Text>
                    <View style={[
                      rs.inputField,
                      resetEmailIsValid && rs.inputFieldValid,
                      resetHasError && rs.inputFieldError,
                    ]}>
                      <TextInput
                        style={rs.inputText}
                        value={resetEmail}
                        onChangeText={handleResetEmailChange}
                        placeholder="you@email.com"
                        placeholderTextColor="#B4B2A9"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={handleSendReset}
                        editable={!resetLoading}
                      />
                      <Feather
                        name={resetEmailIsValid ? 'check' : 'mail'}
                        size={15}
                        color={
                          resetHasError ? '#C0392B'
                            : resetEmailIsValid ? '#1D9E75'
                              : '#B4B2A9'
                        }
                      />
                    </View>
                  </View>

                  {resetHasError ? (
                    <View style={rs.msgRow}>
                      <Feather name="alert-circle" size={12} color="#C0392B" />
                      <Text style={rs.msgTxtError}>{resetEmailError}</Text>
                    </View>
                  ) : !resetEmailIsEmpty ? null : (
                    <View style={rs.msgRow}>
                      <Feather name="info" size={12} color="#9C9A92" />
                      <Text style={rs.msgTxtHint}>
                        Enter the email you used to create your Hadin account.
                      </Text>
                    </View>
                  )}

                  <View style={rs.btnGroup}>
                    {resetLoading ? (
                      <View style={rs.loadingBtn}>
                        <ActivityIndicator color="#fff" size="small" />
                        <Text style={rs.loadingTxt}>Sending…</Text>
                      </View>
                    ) : (
                      <Pressable
                        style={[rs.btnPrimary, !resetCanSubmit && rs.btnPrimaryDisabled]}
                        onPress={handleSendReset}
                        disabled={!resetCanSubmit}
                      >
                        <Text style={rs.btnPrimaryTxt}>Send reset link</Text>
                      </Pressable>
                    )}
                    <Pressable
                      style={[rs.btnSecondary, resetLoading && rs.btnSecondaryDisabled]}
                      onPress={handleCloseResetSheet}
                      disabled={resetLoading}
                    >
                      <Text style={[rs.btnSecondaryTxt, resetLoading && rs.btnSecondaryTxtDisabled]}>
                        Cancel
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
        </Modal>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
};

// ── Main screen styles ──
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F7F8FC',
  },
  keyboardRoot: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoMark: {
    width: 52,
    height: 52,
    marginBottom: 12,
  },
  heroTitle: {
    color: '#060B16',
    fontSize: 27,
    fontWeight: '800',
    marginBottom: 8,
  },
  heroSubtitle: {
    color: '#374151',
    fontSize: 14,
    textAlign: 'center',
  },

  // Card
  card: {
    borderRadius: 8,
    overflow: 'hidden',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#DEE3EA',
  },

  // Body
  cardBody: {
    backgroundColor: '#fff',
    paddingHorizontal: 23,
    paddingTop: 23,
    paddingBottom: 25,
  },

  // Google button
  googleBtn: {
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D7DCE3',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginBottom: 22,
  },
  googleBtnDisabled: { opacity: 0.6 },
  pressed: { opacity: 0.8 },
  googleIcon: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleLogo: {
    width: 18,
    height: 18,
  },
  googleBtnText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },

  // Divider
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#D6DAE1',
  },
  dividerText: {
    marginHorizontal: 10,
    fontSize: 10,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0,
  },

  // Error banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    color: colors.danger,
  },

  // Fields
  fieldGroup: { marginBottom: 16 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#5B21B6',
    letterSpacing: 0,
    marginBottom: 4,
  },
  fieldLabelInline: {
    fontSize: 10,
    fontWeight: '800',
    color: '#5B21B6',
    letterSpacing: 0,
  },
  securityKeyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  recoveryLink: {
    fontSize: 10,
    fontWeight: '700',
    color: '#5B21B6',
  },
  inputWrapper: {
    height: 44,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: '#ECEEF1',
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    color: '#0F172A',
    fontSize: 13,
    height: '100%',
  },
  eyeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // CTA button
  ctaBtn: {
    height: 45,
    borderRadius: 8,
    backgroundColor: '#4B00B5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    shadowColor: '#4B00B5',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 3,
  },
  ctaBtnPressed: { opacity: 0.85 },
  ctaBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },

  // Footer
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 31,
  },
  footerText: {
    fontSize: 11,
    color: '#4B5563',
  },
  footerLink: {
    fontSize: 11,
    fontWeight: '800',
    color: '#5B21B6',
  },
});

// ── Reset sheet styles ──
const rs = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  kav: { width: '100%' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 32,
  },
  handle: {
    width: 32,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 2,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 16,
    marginBottom: 12,
  },
  iconWrapBrand: { backgroundColor: '#F1E9FA' },
  iconWrapGreen: { backgroundColor: '#EFF9F4' },
  iconWrapRed: { backgroundColor: '#FDEDEC' },
  title: {
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: '#1A1A1A',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  subtitle: {
    textAlign: 'center',
    fontSize: 11,
    color: '#9C9A92',
    lineHeight: 17,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  subtitleEmail: {
    color: '#4B0082',
    fontWeight: '600',
  },
  inputWrap: { marginHorizontal: 16, marginBottom: 8 },
  inputLbl: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9C9A92',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  inputField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F4F3EF',
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: '#EEECe6',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputFieldValid: {
    borderWidth: 1.5,
    borderColor: '#1D9E75',
    backgroundColor: '#fff',
  },
  inputFieldError: {
    borderWidth: 1.5,
    borderColor: '#C0392B',
    backgroundColor: '#fff',
  },
  inputText: {
    flex: 1,
    fontSize: 11,
    color: '#1A1A1A',
    padding: 0,
  },
  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  msgTxtHint: {
    flex: 1,
    fontSize: 10,
    color: '#9C9A92',
    lineHeight: 15,
  },
  msgTxtError: {
    flex: 1,
    fontSize: 10,
    color: '#C0392B',
    lineHeight: 15,
  },
  btnGroup: {
    paddingHorizontal: 16,
    gap: 7,
    marginTop: 4,
  },
  btnPrimary: {
    backgroundColor: '#4B0082',
    borderRadius: 11,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryDisabled: { opacity: 0.5 },
  btnPrimaryTxt: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  btnSecondary: {
    backgroundColor: '#F4F3EF',
    borderRadius: 11,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryDisabled: { opacity: 0.4 },
  btnSecondaryTxt: {
    fontSize: 12,
    color: '#9C9A92',
    fontWeight: '500',
  },
  btnSecondaryTxtDisabled: { color: '#B4B2A9' },
  loadingBtn: {
    backgroundColor: '#4B0082',
    borderRadius: 11,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingTxt: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  sentStrip: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#EFF9F4',
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#C6E8D5',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sentStripText: { flex: 1 },
  sentTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F6E56',
  },
  sentSub: {
    fontSize: 10,
    color: '#1D9E75',
    marginTop: 1,
  },
});

export default LoginScreen;

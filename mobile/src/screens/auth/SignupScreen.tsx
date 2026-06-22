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
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AuthStackParamList } from '../../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Signup'>;
};

const SignupScreen = ({ navigation }: Props) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [touched, setTouched] = useState({
    fullName: false,
    email: false,
    password: false,
    confirmPassword: false,
  });
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const errors = {
    fullName: !fullName.trim()
      ? 'Full name is required'
      : fullName.trim().length < 2
      ? 'Full name must be at least 2 characters'
      : '',
    email: !email.trim()
      ? 'Email is required'
      : !emailValid
      ? 'Enter a valid email address'
      : '',
    password: !password
      ? 'Password is required'
      : password.length < 8
      ? 'Password must be at least 8 characters'
      : '',
    confirmPassword: !confirmPassword
      ? 'Please confirm your password'
      : confirmPassword !== password
      ? 'Passwords do not match'
      : '',
  };

  const isFormValid = Object.values(errors).every((e) => !e);

  const blur = (field: keyof typeof touched) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  const handleSubmit = async () => {
    if (!isFormValid) {
      setTouched({ fullName: true, email: true, password: true, confirmPassword: true });
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
      'We sent a confirmation link to ' + email.trim() + '. Click it to activate your account.',
      [{ text: 'OK', onPress: () => navigation.navigate('Login') }]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Hadin</Text>
          <Text style={styles.headerSubtitle}>Never travel alone again.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Create account</Text>
          <Text style={styles.cardSubtitle}>Join your circle. Travel with confidence.</Text>

          {serverError ? <Text style={styles.serverError}>{serverError}</Text> : null}

          {/* Full name */}
          <View style={styles.inputGroup}>
            <View style={[styles.inputWrapper, touched.fullName && errors.fullName ? styles.inputError : null]}>
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                onBlur={() => blur('fullName')}
                editable={!loading}
                placeholder="Full name"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="next"
                autoCapitalize="words"
              />
            </View>
            {touched.fullName && errors.fullName ? <Text style={styles.errorText}>{errors.fullName}</Text> : null}
          </View>

          {/* Email */}
          <View style={styles.inputGroup}>
            <View style={[styles.inputWrapper, touched.email && errors.email ? styles.inputError : null]}>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                onBlur={() => blur('email')}
                editable={!loading}
                placeholder="Email address"
                placeholderTextColor={colors.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
            {touched.email && errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
          </View>

          {/* Phone (optional) */}
          <View style={styles.inputGroup}>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                editable={!loading}
                placeholder="Phone number (optional)"
                placeholderTextColor={colors.textTertiary}
                keyboardType="phone-pad"
                returnKeyType="next"
                autoCorrect={false}
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.inputGroup}>
            <View style={[styles.inputWrapper, touched.password && errors.password ? styles.inputError : null]}>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                onBlur={() => blur('password')}
                editable={!loading}
                placeholder="Password (min. 8 characters)"
                placeholderTextColor={colors.textTertiary}
                secureTextEntry={!showPassword}
                returnKeyType="next"
              />
              <Pressable onPress={() => setShowPassword(!showPassword)}>
                <Feather
                  name={showPassword ? 'eye-off' : 'eye'}
                  size={18}
                  color={colors.textSecondary}
                  style={styles.rightIcon}
                />
              </Pressable>
            </View>
            {touched.password && errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
          </View>

          {/* Confirm password */}
          <View style={styles.inputGroup}>
            <View style={[styles.inputWrapper, touched.confirmPassword && errors.confirmPassword ? styles.inputError : null]}>
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                onBlur={() => blur('confirmPassword')}
                editable={!loading}
                placeholder="Confirm password"
                placeholderTextColor={colors.textTertiary}
                secureTextEntry={!showConfirm}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
              <Pressable onPress={() => setShowConfirm(!showConfirm)}>
                <Feather
                  name={showConfirm ? 'eye-off' : 'eye'}
                  size={18}
                  color={colors.textSecondary}
                  style={styles.rightIcon}
                />
              </Pressable>
            </View>
            {touched.confirmPassword && errors.confirmPassword ? <Text style={styles.errorText}>{errors.confirmPassword}</Text> : null}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              !isFormValid && styles.buttonDisabled,
              pressed && isFormValid ? styles.buttonPressed : null,
            ]}
            onPress={handleSubmit}
            disabled={!isFormValid || loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Create account</Text>
            )}
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            style={styles.socialButton}
            onPress={() => Alert.alert('Coming soon', 'Google sign-in will be available soon.')}
          >
            <Text style={styles.socialButtonText}>Continue with Google</Text>
          </Pressable>
        </View>

        <View style={styles.bottomRow}>
          <Text style={styles.bottomText}>Already have an account? </Text>
          <Pressable onPress={() => navigation.navigate('Login')} disabled={loading}>
            <Text style={styles.bottomLink}>Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { paddingBottom: spacing.gap32 },
  header: {
    height: 140,
    backgroundColor: colors.ink,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.screenPadding,
  },
  headerTitle: {
    color: colors.white,
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  headerSubtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  card: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.screenPadding,
    marginTop: -20,
    borderRadius: spacing.borderRadiusLg,
    padding: spacing.screenPadding,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardSubtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: spacing.gap24,
  },
  inputGroup: { marginBottom: spacing.gap16 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: spacing.inputHeight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.inputRadius,
    paddingHorizontal: spacing.gap16,
    backgroundColor: colors.background,
  },
  inputError: { borderColor: colors.danger },
  rightIcon: { marginLeft: spacing.gap12 },
  input: {
    flex: 1,
    color: colors.textPrimary,
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
  button: {
    height: spacing.buttonHeight,
    borderRadius: spacing.borderRadius,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.gap8,
    marginBottom: spacing.gap16,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    color: colors.white,
    fontSize: fontSizes.button,
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.gap16,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    marginHorizontal: spacing.gap12,
    color: colors.textSecondary,
    fontSize: fontSizes.caption,
  },
  socialButton: {
    height: spacing.buttonHeight,
    borderRadius: spacing.borderRadius,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  socialButtonText: {
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    fontWeight: '500',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.gap24,
  },
  bottomText: { color: colors.textSecondary, fontSize: fontSizes.body },
  bottomLink: {
    color: colors.primary,
    fontSize: fontSizes.body,
    fontWeight: '600',
  },
});

export default SignupScreen;

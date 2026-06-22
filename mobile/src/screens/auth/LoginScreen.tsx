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
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AuthStackParamList } from '../../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Login'>;
};

const LAST_IDENTIFIER_KEY = 'HADIN_LAST_SIGNIN_ID';

const LoginScreen = ({ navigation }: Props) => {
  const identifierRef = useRef<TextInput | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
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
      setAuthError('Please enter your email or phone number and password');
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
      setAuthError('Incorrect email/phone or password');
      return;
    }

    AsyncStorage.setItem(LAST_IDENTIFIER_KEY, identifier.trim()).catch(() => {});
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
          <Text style={styles.cardTitle}>Welcome back</Text>
          <Text style={styles.cardSubtitle}>Sign in to continue</Text>

          <View style={styles.inputGroup}>
            <View style={styles.inputWrapper}>
              <Feather name="user" size={18} color={colors.textSecondary} style={styles.leftIcon} />
              <TextInput
                ref={identifierRef}
                style={styles.input}
                value={identifier}
                onChangeText={setIdentifier}
                editable={!loading}
                placeholder="Email or phone number"
                placeholderTextColor={colors.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <View style={styles.inputWrapper}>
              <Feather name="lock" size={18} color={colors.textSecondary} style={styles.leftIcon} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                editable={!loading}
                placeholder="Password"
                placeholderTextColor={colors.textTertiary}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
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
            style={({ pressed }) => [
              styles.button,
              pressed && !loading ? styles.buttonPressed : null,
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
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
          <Text style={styles.bottomText}>Don't have an account? </Text>
          <Pressable onPress={() => navigation.navigate('Signup')} disabled={loading}>
            <Text style={styles.bottomLink}>Sign up</Text>
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
  headerSubtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
  },
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
  leftIcon: { marginRight: spacing.gap12 },
  rightIcon: { marginLeft: spacing.gap12 },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    height: '100%',
  },
  forgotRow: { alignItems: 'flex-end', marginBottom: spacing.gap20 },
  forgotText: { color: colors.primary, fontSize: fontSizes.caption },
  errorText: {
    color: colors.danger,
    fontSize: fontSizes.caption,
    marginBottom: spacing.gap16,
  },
  button: {
    height: spacing.buttonHeight,
    borderRadius: spacing.borderRadius,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.gap16,
  },
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

export default LoginScreen;

import React, { useEffect, useState } from 'react';
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
import { AppStackParamList } from '../../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<AppStackParamList, 'PhoneCapture'>;
};

// Accept 10 digits (user types after the +234 badge)
const DIGITS_REGEX = /^\d{10}$/;

const PhoneCaptureScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();

  const [digits, setDigits] = useState('');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const phoneError = !digits.trim()
    ? 'Phone number is required'
    : !DIGITS_REGEX.test(digits.trim())
    ? 'Enter a valid 10-digit Nigerian number'
    : '';

  const handleSubmit = async () => {
    setTouched(true);
    if (phoneError) return;

    setLoading(true);
    setServerError('');

    const e164 = `+234${digits.trim()}`;

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setServerError('Session expired. Please sign in again.');
      setLoading(false);
      return;
    }

    const { error } = await supabase.from('profiles').upsert({
      id: userData.user.id,
      phone: e164,
    });

    setLoading(false);

    if (error) {
      setServerError('Could not save your phone number. Please try again.');
      return;
    }

    navigation.reset({ index: 0, routes: [{ name: 'Subscription' }] });
  };

  const hasError = touched && phoneError !== '';

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Icon */}
        <View style={styles.iconCircle}>
          <Feather name="phone" size={26} color={colors.brand.primary} />
        </View>

        {/* Heading */}
        <Text style={styles.title}>One last step</Text>
        <Text style={styles.subtitle}>
          Add your phone number so your circle can reach you.
        </Text>

        {/* Error banner */}
        {serverError ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={14} color={colors.danger} />
            <Text style={styles.errorBannerText}>{serverError}</Text>
          </View>
        ) : null}

        {/* Phone field */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>PHONE NUMBER</Text>
          <View style={[styles.inputWrapper, hasError && styles.inputWrapperError]}>
            <View style={styles.prefixBadge}>
              <Text style={styles.prefixText}>+234</Text>
            </View>
            <View style={styles.prefixDivider} />
            <TextInput
              style={styles.input}
              value={digits}
              onChangeText={(text) => setDigits(text.replace(/\D/g, '').slice(0, 10))}
              onBlur={() => setTouched(true)}
              editable={!loading}
              placeholder="8012345678"
              placeholderTextColor="#B4B2A9"
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              maxLength={10}
            />
          </View>
          {hasError ? (
            <View style={styles.inlineError}>
              <Feather name="alert-circle" size={11} color={colors.danger} />
              <Text style={styles.inlineErrorText}>{phoneError}</Text>
            </View>
          ) : null}
        </View>

        {/* Submit */}
        <Pressable
          style={({ pressed }) => [
            styles.ctaBtn,
            loading && styles.ctaBtnDisabled,
            pressed && !loading && styles.ctaBtnPressed,
          ]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Feather name="arrow-right" size={17} color="#fff" />
              <Text style={styles.ctaBtnText}>Continue</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.brand.bgSurface,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.screenPadding,
    justifyContent: 'center',
  },

  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brand.light,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.gap20,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: spacing.gap8,
  },
  subtitle: {
    fontSize: fontSizes.body,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.gap32,
    paddingHorizontal: spacing.gap8,
  },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gap8,
    backgroundColor: '#FEF2F2',
    borderRadius: spacing.inputRadius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: spacing.gap16,
  },
  errorBannerText: {
    flex: 1,
    fontSize: fontSizes.caption,
    color: colors.danger,
  },

  fieldGroup: {
    marginBottom: spacing.gap24,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  inputWrapper: {
    height: spacing.inputHeight,
    borderRadius: spacing.inputRadius,
    borderWidth: 1,
    borderColor: '#E2E0DA',
    backgroundColor: '#FAFAF9',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  inputWrapperError: {
    borderColor: colors.danger,
    backgroundColor: '#fff',
  },
  prefixBadge: {
    paddingHorizontal: 12,
    height: '100%',
    justifyContent: 'center',
    backgroundColor: '#F1F0EC',
  },
  prefixText: {
    fontSize: fontSizes.body,
    fontWeight: '600',
    color: '#0F172A',
  },
  prefixDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E0DA',
  },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    color: '#0F172A',
    fontSize: fontSizes.body,
    height: '100%',
  },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  inlineErrorText: {
    fontSize: 10,
    color: colors.danger,
  },

  ctaBtn: {
    height: spacing.buttonHeight,
    borderRadius: spacing.borderRadius,
    backgroundColor: colors.brand.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.gap8,
  },
  ctaBtnDisabled: { opacity: 0.6 },
  ctaBtnPressed: { opacity: 0.85 },
  ctaBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default PhoneCaptureScreen;

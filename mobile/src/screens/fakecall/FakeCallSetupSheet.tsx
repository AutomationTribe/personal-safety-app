import React, { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, fontSizes, spacing } from '../../styles/tokens';

const LAST_NAME_KEY = 'HADIN_FAKECALL_LAST_NAME';
const DEFAULT_TIMER = '30';
const MIN_TIMER = 5;
const MAX_TIMER = 300;

interface FakeCallSetupSheetProps {
  visible: boolean;
  onClose: () => void;
  onSchedule: (callerName: string, seconds: number) => void;
}

const FakeCallSetupSheet = ({ visible, onClose, onSchedule }: FakeCallSetupSheetProps) => {
  const [name, setName] = useState('');
  const [timer, setTimer] = useState(DEFAULT_TIMER);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setError('');
    setTimer(DEFAULT_TIMER);
    AsyncStorage.getItem(LAST_NAME_KEY)
      .then((saved) => setName(saved ?? ''))
      .catch(() => setName(''));
  }, [visible]);

  const handleClose = () => {
    Keyboard.dismiss();
    onClose();
  };

  const handleSchedule = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Enter a caller name.');
      return;
    }
    const seconds = parseInt(timer, 10);
    if (!Number.isFinite(seconds) || seconds < MIN_TIMER || seconds > MAX_TIMER) {
      setError(`Timer must be between ${MIN_TIMER} and ${MAX_TIMER} seconds.`);
      return;
    }

    Keyboard.dismiss();
    AsyncStorage.setItem(LAST_NAME_KEY, trimmedName).catch(() => {});
    onSchedule(trimmedName, seconds);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={handleClose}>
      <KeyboardAvoidingView style={fc.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={handleClose} />
        <View style={fc.sheet}>
          <View style={fc.headerRow}>
            <Text style={fc.title}>Fake a Call</Text>
            <Pressable onPress={handleClose} hitSlop={8} style={fc.closeBtn}>
              <Feather name="x" size={20} color={colors.brand.textPrimary} />
            </Pressable>
          </View>

          <View style={fc.fieldGroup}>
            <Text style={fc.fieldLabel}>Caller Display Name</Text>
            <View style={fc.inputWrap}>
              <Feather name="user" size={16} color="#9C9A92" style={fc.inputIcon} />
              <TextInput
                style={fc.input}
                value={name}
                onChangeText={setName}
                placeholder="Emergency Contact"
                placeholderTextColor="#B4B2A9"
                returnKeyType="next"
              />
            </View>
          </View>

          <View style={fc.fieldGroup}>
            <Text style={fc.fieldLabel}>Timer (seconds)</Text>
            <View style={fc.inputWrap}>
              <Feather name="clock" size={16} color="#9C9A92" style={fc.inputIcon} />
              <TextInput
                style={fc.input}
                value={timer}
                onChangeText={(t) => setTimer(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={handleSchedule}
              />
            </View>
          </View>

          {error ? (
            <View style={fc.errorRow}>
              <Feather name="alert-circle" size={13} color="#C0392B" />
              <Text style={fc.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [fc.ctaBtn, pressed && fc.ctaBtnPressed]}
            onPress={handleSchedule}
          >
            <Feather name="clock" size={17} color={colors.white} />
            <Text style={fc.ctaBtnText}>Schedule Call</Text>
          </Pressable>
          <Text style={fc.ctaSubtitle}>This will trigger a realistic incoming call screen.</Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const fc = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: spacing.screenPadding,
    paddingTop: 22,
    paddingBottom: 32,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.brand.textPrimary },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F3EF' },
  fieldGroup: { marginBottom: spacing.gap16 },
  fieldLabel: { fontSize: 13, color: colors.brand.textSecondary, fontWeight: '600', marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: spacing.inputHeight,
    borderRadius: spacing.inputRadius,
    borderWidth: 1,
    borderColor: '#E2E0DA',
    backgroundColor: '#FAFAF8',
    paddingHorizontal: 14,
    gap: 10,
  },
  inputIcon: {},
  input: { flex: 1, fontSize: fontSizes.body, color: colors.brand.textPrimary, height: '100%' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.gap12 },
  errorText: { fontSize: 12, color: '#C0392B', flex: 1 },
  ctaBtn: {
    height: spacing.buttonHeight,
    borderRadius: spacing.borderRadius,
    backgroundColor: '#4B0082',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  ctaBtnPressed: { opacity: 0.85 },
  ctaBtnText: { color: colors.white, fontSize: fontSizes.button, fontWeight: '700' },
  ctaSubtitle: { fontSize: 12, color: colors.brand.textSecondary, textAlign: 'center', marginTop: 10 },
});

export default FakeCallSetupSheet;

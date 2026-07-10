import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  TrustedContact,
  addContact,
  formatNigerianPhone,
} from '../../services/CircleService';
import { colors, fontSizes, spacing } from '../../styles/tokens';

const NIGERIAN_E164_RE = /^\+234[789]\d{9}$/;
const RELATIONSHIPS = ['Family Member', 'Wife', 'Husband', 'Son', 'Daughter', 'Sister', 'Brother', 'Mother', 'Father', 'Friend', 'Partner', 'Other'] as const;
type Relationship = typeof RELATIONSHIPS[number];

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved: (contact: TrustedContact) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidNigerianPhone(phone: string): boolean {
  return NIGERIAN_E164_RE.test(formatNigerianPhone(phone));
}

// ── Component ─────────────────────────────────────────────────────────────────

const AddContactModal = ({ visible, onClose, onSaved }: Props) => {
  const nameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const sheetY = useRef(new Animated.Value(420)).current;
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const saveScale = useRef(new Animated.Value(1)).current;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState<Relationship | ''>('');
  const [errors, setErrors] = useState<{ name?: string; phone?: string; relationship?: string }>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setName('');
      setPhone('');
      setEmail('');
      setRelationship('');
      setErrors({});
      setSaveError('');
      setSaving(false);
      sheetY.setValue(420);
      sheetOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(sheetY, {
          toValue: 0,
          useNativeDriver: true,
          stiffness: 150,
          damping: 22,
          mass: 0.9,
          overshootClamping: false,
        }),
        Animated.timing(sheetOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
      setTimeout(() => nameRef.current?.focus(), 200);
    }
  }, [visible, sheetOpacity, sheetY]);

  // ── Validation ────────────────────────────────────────────────────────────

  function validate(): boolean {
    const next: { name?: string; phone?: string; relationship?: string } = {};

    if (!name.trim() || name.trim().length < 2) {
      next.name = name.trim() ? 'Name must be at least 2 characters.' : 'Name is required.';
    }
    if (!phone.trim()) {
      next.phone = 'Phone number is required.';
    } else if (!isValidNigerianPhone(phone)) {
      next.phone = 'Enter a valid Nigerian number (e.g. 08012345678).';
    }
    if (!relationship) {
      next.relationship = 'Please select a relationship.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    setSaveError('');

    const result = await addContact({
      name: name.trim(),
      phone: phone.trim(),
      ...(email.trim() ? { email: email.trim() } : {}),
      relationship,
    });

    setSaving(false);

    if (result.error || !result.data) {
      setSaveError(result.error ?? 'Something went wrong. Please try again.');
      return;
    }

    onSaved(result.data);
    onClose();
  };

  const animateSave = (toValue: number) => {
    Animated.spring(saveScale, {
      toValue,
      useNativeDriver: true,
      speed: 30,
      bounciness: 6,
    }).start();
  };

  // ── Derived UI state ──────────────────────────────────────────────────────

  const phoneFormatted = formatNigerianPhone(phone);
  const phoneValid = isValidNigerianPhone(phone);
  const displayName = name.trim() || null;
  const smsNote = displayName
    ? `${displayName} will receive an SMS letting them know they've been added to your Hadin circle.`
    : "They will receive an SMS letting them know they've been added to your Hadin circle.";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView style={styles.overlay} behavior="padding">
        <Pressable style={styles.dismissArea} onPress={onClose} />
        <Animated.View style={[styles.sheet, { opacity: sheetOpacity, transform: [{ translateY: sheetY }] }]}>
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>

          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Add to your circle</Text>
            <Pressable
              style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
              onPress={onClose}
              hitSlop={8}
            >
              <Feather name="x" size={16} color="#4B5563" />
            </Pressable>
          </View>

          <View style={styles.divider} />

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
              {/* ── Name ── */}
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>
                  Full Name <Text style={styles.required}>*</Text>
                </Text>
                <View
                  style={[
                    styles.inputWrapper,
                    focusedField === 'name' && styles.inputFocused,
                    errors.name ? styles.inputErrorBorder : null,
                  ]}
                >
                  <TextInput
                    ref={nameRef}
                    style={styles.input}
                    value={name}
                    onChangeText={(t) => { setName(t); setErrors((e) => ({ ...e, name: undefined })); }}
                    onFocus={() => setFocusedField('name')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="e.g. John Doe"
                    placeholderTextColor="#8E95A3"
                    autoCapitalize="words"
                    returnKeyType="next"
                    onSubmitEditing={() => phoneRef.current?.focus()}
                    editable={!saving}
                  />
                </View>
                {errors.name ? <Text style={styles.errorText}>{errors.name}</Text> : null}
              </View>

              {/* ── Phone ── */}
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>
                  Phone Number <Text style={styles.required}>*</Text>
                </Text>
                <View
                  style={[
                    styles.inputWrapper,
                    focusedField === 'phone' && styles.inputFocused,
                    errors.phone ? styles.inputErrorBorder : null,
                  ]}
                >
                  <TextInput
                    ref={phoneRef}
                    style={styles.input}
                    value={phone}
                    onChangeText={(t) => {
                      setPhone(t);
                      setErrors((e) => ({ ...e, phone: undefined }));
                    }}
                    onBlur={() => {
                      setFocusedField(null);
                    if (phone.trim()) setPhone(phoneFormatted);
                  }}
                    onFocus={() => setFocusedField('phone')}
                    placeholder="+1(555) 000-0000"
                    placeholderTextColor="#8E95A3"
                    keyboardType="phone-pad"
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                    editable={!saving}
                  />
                  {phoneValid && (
                    <View style={styles.validIcon}>
                      <Feather name="check-circle" size={16} color="#8491FF" />
                    </View>
                  )}
                </View>
                {errors.phone ? <Text style={styles.errorText}>{errors.phone}</Text> : null}
              </View>

              {/* ── Email ── */}
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>
                  Email{' '}
                  <Text style={styles.optionalLabel}>(Optional)</Text>
                </Text>
                <View
                  style={[
                    styles.inputWrapper,
                    focusedField === 'email' && styles.inputFocused,
                  ]}
                >
                  <TextInput
                    ref={emailRef}
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="john@example.com"
                    placeholderTextColor="#8E95A3"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    editable={!saving}
                  />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>
                  Relationship <Text style={styles.required}>*</Text>
                </Text>
                <View style={styles.chipsRow}>
                  {RELATIONSHIPS.map((r) => {
                    const active = relationship === r;
                    return (
                      <Pressable
                        key={r}
                        style={({ pressed }) => [
                          styles.chip,
                          active && styles.chipActive,
                          pressed && !active && styles.chipPressed,
                        ]}
                        onPress={() => {
                          setRelationship(r);
                          setErrors((e) => ({ ...e, relationship: undefined }));
                        }}
                        disabled={saving}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {r}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {errors.relationship ? (
                  <Text style={styles.errorText}>{errors.relationship}</Text>
                ) : null}
              </View>

              <View style={styles.smsNote}>
                <Feather name="message-circle" size={15} color="#6B008F" style={styles.smsIcon} />
                <Text style={styles.smsText}>{smsNote}</Text>
              </View>

              {/* ── Save error ── */}
              {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}

              {/* ── Save button ── */}
              <Animated.View style={{ transform: [{ scale: saveScale }] }}>
                <Pressable
                  style={({ pressed }) => [
                    styles.saveBtn,
                    saving && styles.saveBtnDisabled,
                    pressed && !saving && styles.saveBtnPressed,
                  ]}
                  onPress={handleSave}
                  onPressIn={() => animateSave(0.97)}
                  onPressOut={() => animateSave(1)}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>Add to Circle</Text>
                  )}
                </Pressable>
              </Animated.View>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
  },

  // Handle
  handleRow: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  handle: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#D7D9E8',
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.gap20,
    paddingTop: spacing.gap12,
    paddingBottom: spacing.gap12,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#F1F3FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnPressed: { opacity: 0.65 },
  divider: {
    height: 0.5,
    backgroundColor: '#EEF0F5',
  },

  // Scroll body
  scroll: { flexGrow: 0 },
  scrollContent: {
    paddingHorizontal: spacing.gap20,
    paddingTop: spacing.gap16,
    paddingBottom: spacing.gap32,
    gap: spacing.gap16,
  },

  // Fields
  fieldGroup: { gap: 7 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  required: { color: '#6B008F' },
  optionalLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 45,
    borderWidth: 1,
    borderColor: '#D7D8E8',
    borderRadius: 6,
    paddingHorizontal: 15,
    backgroundColor: '#F4F5FB',
  },
  inputFocused: {
    borderColor: '#6B008F',
    backgroundColor: '#FFFFFF',
  },
  inputErrorBorder: {
    borderColor: colors.danger,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    color: '#111827',
    fontSize: 14,
    height: '100%',
  },
  validIcon: { marginLeft: spacing.gap8 },
  errorText: {
    fontSize: fontSizes.small,
    color: colors.danger,
    marginTop: 2,
  },

  // Relationship chips
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.gap8,
  },
  chip: {
    paddingHorizontal: spacing.gap12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F1F3FD',
    borderWidth: 1,
    borderColor: '#D7D9E8',
  },
  chipActive: {
    backgroundColor: '#6B008F',
    borderColor: '#6B008F',
  },
  chipPressed: { opacity: 0.7 },
  chipText: {
    fontSize: fontSizes.caption,
    fontWeight: '700',
    color: '#4B5563',
  },
  chipTextActive: {
    color: colors.white,
  },

  // SMS note
  smsNote: {
    flexDirection: 'row',
    backgroundColor: '#F1E7FF',
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: '#D8B4FE',
    padding: spacing.gap12,
    gap: spacing.gap8,
  },
  smsIcon: { marginTop: 1, flexShrink: 0 },
  smsText: {
    flex: 1,
    fontSize: fontSizes.caption,
    color: '#6B008F',
    lineHeight: 19,
  },

  // Save
  saveError: {
    fontSize: fontSizes.caption,
    color: colors.danger,
    textAlign: 'center',
  },
  saveBtn: {
    height: spacing.buttonHeight,
    borderRadius: 13,
    backgroundColor: '#6B008F',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4C1D95',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.24,
    shadowRadius: 8,
    elevation: 5,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnText: {
    color: colors.white,
    fontSize: fontSizes.button,
    fontWeight: '800',
  },
});

export default AddContactModal;

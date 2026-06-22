import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import {
  TrustedContact,
  updateContact,
  formatNigerianPhone,
} from '../../services/CircleService';
import { colors, fontSizes, spacing } from '../../styles/tokens';

// ── Constants ─────────────────────────────────────────────────────────────────

const RELATIONSHIPS = ['Sister', 'Brother', 'Mother', 'Father', 'Friend', 'Partner', 'Other'] as const;
type Relationship = typeof RELATIONSHIPS[number];

const NIGERIAN_E164_RE = /^\+234[789]\d{9}$/;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  contact: TrustedContact | null;
  onClose: () => void;
  onUpdated: (contact: TrustedContact) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidNigerianPhone(phone: string): boolean {
  return NIGERIAN_E164_RE.test(formatNigerianPhone(phone));
}

function toRelationship(value: string): Relationship | '' {
  return (RELATIONSHIPS as readonly string[]).includes(value)
    ? (value as Relationship)
    : '';
}

// ── Component ─────────────────────────────────────────────────────────────────

const EditContactModal = ({ visible, contact, onClose, onUpdated }: Props) => {
  const nameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState<Relationship | ''>('');
  const [errors, setErrors] = useState<{ name?: string; phone?: string; relationship?: string }>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Sync fields whenever the contact prop changes (or modal opens)
  useEffect(() => {
    if (visible && contact) {
      setName(contact.name);
      setPhone(contact.phone);
      setEmail(contact.email ?? '');
      setRelationship(toRelationship(contact.relationship));
      setErrors({});
      setSaveError('');
      setSaving(false);
    }
  }, [visible, contact]);

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
    if (!contact || !validate()) return;
    setSaving(true);
    setSaveError('');

    const result = await updateContact(contact.id, {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || undefined,
      relationship,
    });

    setSaving(false);

    if (result.error || !result.data) {
      setSaveError(result.error ?? 'Something went wrong. Please try again.');
      return;
    }

    onUpdated(result.data);
    onClose();
  };

  // ── Derived UI state ──────────────────────────────────────────────────────

  const phoneFormatted = formatNigerianPhone(phone);
  const phoneValid = isValidNigerianPhone(phone);

  if (!contact) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kavWrapper}
        >
          <Pressable style={styles.dismissArea} onPress={onClose} />
          <View style={styles.sheet}>
            {/* Handle */}
            <View style={styles.handleRow}>
              <View style={styles.handle} />
            </View>

            {/* Header */}
            <View style={styles.headerRow}>
              <View style={styles.headerLeft}>
                <Text style={styles.headerTitle}>Edit contact</Text>
                <View style={styles.nameBadge}>
                  <Text style={styles.nameBadgeText} numberOfLines={1}>
                    {contact.name}
                  </Text>
                </View>
              </View>
              <Pressable
                style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
                onPress={onClose}
                hitSlop={8}
              >
                <Feather name="x" size={16} color={colors.brand.textSecondary} />
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
                  Name <Text style={styles.required}>*</Text>
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
                    placeholder="Full name"
                    placeholderTextColor="#C5C3BB"
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
                  Phone <Text style={styles.required}>*</Text>
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
                    placeholder="08012345678 or +234…"
                    placeholderTextColor="#C5C3BB"
                    keyboardType="phone-pad"
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                    editable={!saving}
                  />
                  {phoneValid && (
                    <View style={styles.validIcon}>
                      <Feather name="check-circle" size={16} color={colors.brand.mid} />
                    </View>
                  )}
                </View>
                {errors.phone ? <Text style={styles.errorText}>{errors.phone}</Text> : null}
              </View>

              {/* ── Email ── */}
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>
                  Email <Text style={styles.optionalLabel}>(optional)</Text>
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
                    placeholder="their@email.com"
                    placeholderTextColor="#C5C3BB"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    editable={!saving}
                  />
                </View>
              </View>

              {/* ── Relationship chips ── */}
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

              {/* ── Save error ── */}
              {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}

              {/* ── Save button ── */}
              <Pressable
                style={({ pressed }) => [
                  styles.saveBtn,
                  saving && styles.saveBtnDisabled,
                  pressed && !saving && styles.saveBtnPressed,
                ]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>Save changes</Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  kavWrapper: {
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
    backgroundColor: 'rgba(0,0,0,0.1)',
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.gap20,
    paddingTop: spacing.gap12,
    paddingBottom: spacing.gap12,
    gap: spacing.gap12,
  },
  headerLeft: {
    flex: 1,
    gap: 6,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.brand.textPrimary,
    letterSpacing: -0.2,
  },
  nameBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.brand.light,
    borderRadius: 20,
    paddingHorizontal: spacing.gap12,
    paddingVertical: 4,
  },
  nameBadgeText: {
    fontSize: fontSizes.caption,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.brand.bgSurface,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  closeBtnPressed: { opacity: 0.65 },
  divider: {
    height: 0.5,
    backgroundColor: 'rgba(0,0,0,0.08)',
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
  fieldGroup: { gap: 6 },
  label: {
    fontSize: fontSizes.caption,
    fontWeight: '600',
    color: colors.brand.textSecondary,
    letterSpacing: 0.2,
  },
  required: { color: colors.brand.primary },
  optionalLabel: {
    fontSize: 11,
    fontWeight: '400',
    color: '#B0AFA8',
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
  inputFocused: {
    borderColor: colors.brand.mid,
    borderWidth: 1.5,
  },
  inputErrorBorder: {
    borderColor: colors.danger,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    color: colors.brand.textPrimary,
    fontSize: fontSizes.body,
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
    backgroundColor: colors.brand.bgSurface,
  },
  chipActive: {
    backgroundColor: colors.brand.primary,
  },
  chipPressed: { opacity: 0.7 },
  chipText: {
    fontSize: fontSizes.caption,
    fontWeight: '600',
    color: colors.brand.textSecondary,
  },
  chipTextActive: {
    color: colors.white,
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
    backgroundColor: colors.brand.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnText: {
    color: colors.white,
    fontSize: fontSizes.button,
    fontWeight: '700',
  },
});

export default EditContactModal;

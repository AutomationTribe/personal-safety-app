import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { supabase } from '../../lib/supabase';
import { getContacts, TrustedContact } from '../../services/CircleService';
import { startTracking } from '../../services/LocationService';
import { colors, fontSizes, spacing } from '../../styles/tokens';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Trip {
  id: string;
  title: string | null;
  origin: string | null;
  destination: string | null;
  status: 'active' | 'completed' | 'sos';
  started_at: string | null;
  ended_at: string | null;
  expected_duration_minutes: number | null;
  expected_stops: number;
  max_stop_duration_minutes: number;
  contact_ids: string[];
  created_at: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onTripStarted: (trip: Trip) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STOP_OPTIONS = [0, 1, 2, 3, 4, 5] as const;
const DURATION_OPTIONS = [15, 30, 45, 60] as const;
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

// ── Component ─────────────────────────────────────────────────────────────────

const StartTripModal = ({ visible, onClose, onTripStarted }: Props) => {
  const originRef = useRef<TextInput>(null);
  const destRef = useRef<TextInput>(null);

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [expectedStops, setExpectedStops] = useState(0);
  const [maxStopMinutes, setMaxStopMinutes] = useState(30);
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [starting, setStarting] = useState(false);
  const [errors, setErrors] = useState<{ origin?: string; destination?: string; contacts?: string }>({});

  // Reset and load contacts each time modal opens
  useEffect(() => {
    if (!visible) return;
    setOrigin('');
    setDestination('');
    setExpectedStops(0);
    setMaxStopMinutes(30);
    setErrors({});
    setStarting(false);
    setLoadingContacts(true);
    getContacts().then((data) => {
      setContacts(data);
      setSelectedIds(new Set(data.map((c) => c.id))); // pre-check all
      setLoadingContacts(false);
    });
    setTimeout(() => originRef.current?.focus(), 250);
  }, [visible]);

  // ── Validation ────────────────────────────────────────────────────────────

  function validate(): boolean {
    const next: typeof errors = {};
    if (!origin.trim() || origin.trim().length < 2) next.origin = 'Enter your starting point.';
    if (!destination.trim() || destination.trim().length < 2) next.destination = 'Enter your destination.';
    if (selectedIds.size === 0) next.contacts = 'Select at least one contact to alert.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  const toggleContact = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setErrors((e) => ({ ...e, contacts: undefined }));
  };

  const handleStart = async () => {
    if (!validate()) return;
    setStarting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) throw new Error('Not authenticated.');

      const { data, error } = await supabase
        .from('trips')
        .insert({
          user_id: session.user.id,
          status: 'active',
          origin: origin.trim(),
          destination: destination.trim(),
          started_at: new Date().toISOString(),
          expected_stops: expectedStops,
          max_stop_duration_minutes: maxStopMinutes,
        })
        .select()
        .single();

      if (error || !data) throw new Error(error?.message ?? 'Failed to create trip');

      const trip = data as Trip;

      await startTracking(trip.id, 30);

      // Fire and forget — notify contacts in background
      if (session?.access_token) {
        fetch(`${BACKEND_URL}/api/v1/trips/notify-start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            tripId: trip.id,
            origin: origin.trim(),
            destination: destination.trim(),
            contactIds: Array.from(selectedIds),
          }),
        }).catch(() => {});
      }

      onTripStarted(trip);
      onClose();
    } catch (err) {
      setErrors({ origin: err instanceof Error ? err.message : 'Could not start trip. Try again.' });
    } finally {
      setStarting(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const durationLabel = (min: number) => min === 60 ? '1 hour' : `${min} min`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior="padding"
      >
          <Pressable style={styles.dismissArea} onPress={onClose} />
          <View style={styles.sheet}>
            {/* Handle */}
            <View style={styles.handleRow}>
              <View style={styles.handle} />
            </View>

            {/* Header */}
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>Start a trip</Text>
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
              {/* ── Row 1: From / To ── */}
              <View style={styles.row}>
                <View style={styles.rowHalf}>
                  <Text style={styles.label}>From <Text style={styles.required}>*</Text></Text>
                  <View style={[styles.inputWrapper, errors.origin && styles.inputError]}>
                    <TextInput
                      ref={originRef}
                      style={styles.input}
                      value={origin}
                      onChangeText={(t) => { setOrigin(t); setErrors((e) => ({ ...e, origin: undefined })); }}
                      placeholder="Lagos"
                      placeholderTextColor="#C5C3BB"
                      autoCapitalize="words"
                      returnKeyType="next"
                      onSubmitEditing={() => destRef.current?.focus()}
                      editable={!starting}
                    />
                  </View>
                  {errors.origin ? <Text style={styles.errorText}>{errors.origin}</Text> : null}
                </View>

                <View style={styles.rowHalf}>
                  <Text style={styles.label}>To <Text style={styles.required}>*</Text></Text>
                  <View style={[styles.inputWrapper, errors.destination && styles.inputError]}>
                    <TextInput
                      ref={destRef}
                      style={styles.input}
                      value={destination}
                      onChangeText={(t) => { setDestination(t); setErrors((e) => ({ ...e, destination: undefined })); }}
                      placeholder="Abuja"
                      placeholderTextColor="#C5C3BB"
                      autoCapitalize="words"
                      returnKeyType="done"
                      editable={!starting}
                    />
                  </View>
                  {errors.destination ? <Text style={styles.errorText}>{errors.destination}</Text> : null}
                </View>
              </View>

              {/* ── Row 2: Stops / Max stop duration ── */}
              <View style={styles.row}>
                {/* Estimated stops */}
                <View style={styles.rowHalf}>
                  <Text style={styles.label}>Estimated stops</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                    <View style={styles.chipRow}>
                      {STOP_OPTIONS.map((n) => (
                        <Pressable
                          key={n}
                          style={[styles.chip, expectedStops === n && styles.chipActive]}
                          onPress={() => setExpectedStops(n)}
                          disabled={starting}
                        >
                          <Text style={[styles.chipText, expectedStops === n && styles.chipTextActive]}>
                            {n === 5 ? '5+' : `${n}`}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                {/* Max stop duration */}
                <View style={styles.rowHalf}>
                  <Text style={styles.label}>Max stop</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                    <View style={styles.chipRow}>
                      {DURATION_OPTIONS.map((min) => (
                        <Pressable
                          key={min}
                          style={[styles.chip, maxStopMinutes === min && styles.chipActive]}
                          onPress={() => setMaxStopMinutes(min)}
                          disabled={starting}
                        >
                          <Text style={[styles.chipText, maxStopMinutes === min && styles.chipTextActive]}>
                            {durationLabel(min)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              </View>

              {/* ── Contact selector ── */}
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Alert contacts <Text style={styles.required}>*</Text></Text>
                {loadingContacts ? (
                  <ActivityIndicator color={colors.brand.primary} style={{ marginTop: 8 }} />
                ) : contacts.length === 0 ? (
                  <View style={styles.emptyContacts}>
                    <Text style={styles.emptyContactsText}>
                      Add contacts to your circle first.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.contactsList}>
                    {contacts.map((c) => {
                      const selected = selectedIds.has(c.id);
                      return (
                        <Pressable
                          key={c.id}
                          style={styles.contactRow}
                          onPress={() => toggleContact(c.id)}
                          disabled={starting}
                        >
                          <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
                            {selected && <Feather name="check" size={12} color={colors.white} />}
                          </View>
                          <View style={styles.contactAvatar}>
                            <Text style={styles.contactAvatarText}>
                              {c.name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')}
                            </Text>
                          </View>
                          <View style={styles.contactInfo}>
                            <Text style={styles.contactName}>{c.name}</Text>
                            <Text style={styles.contactSub}>{c.relationship}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {errors.contacts ? <Text style={styles.errorText}>{errors.contacts}</Text> : null}
              </View>

              {/* ── Start button ── */}
              <Pressable
                style={({ pressed }) => [
                  styles.startBtn,
                  starting && styles.startBtnDisabled,
                  pressed && !starting && styles.startBtnPressed,
                ]}
                onPress={handleStart}
                disabled={starting}
              >
                {starting ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.startBtnText}>Start trip  →</Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
      </KeyboardAvoidingView>
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
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
  },

  handleRow: { alignItems: 'center', marginTop: 12, marginBottom: 4 },
  handle: { width: 36, height: 3, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.1)' },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.gap20,
    paddingVertical: spacing.gap12,
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.brand.textPrimary, letterSpacing: -0.2 },
  closeBtn: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: colors.brand.bgSurface,
    justifyContent: 'center', alignItems: 'center',
  },
  closeBtnPressed: { opacity: 0.65 },
  divider: { height: 0.5, backgroundColor: 'rgba(0,0,0,0.08)' },

  scroll: { flexGrow: 0 },
  scrollContent: {
    paddingHorizontal: spacing.gap20,
    paddingTop: spacing.gap16,
    paddingBottom: spacing.gap32,
    gap: spacing.gap16,
  },

  // Row layout
  row: { flexDirection: 'row', gap: spacing.gap8 },
  rowHalf: { flex: 1, gap: 6 },

  // Fields
  fieldGroup: { gap: 6 },
  label: { fontSize: fontSizes.caption, fontWeight: '600', color: colors.brand.textSecondary },
  required: { color: colors.brand.primary },
  inputWrapper: {
    height: spacing.inputHeight,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.12)',
    borderRadius: spacing.inputRadius,
    paddingHorizontal: spacing.gap12,
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  inputError: { borderColor: colors.danger, borderWidth: 1 },
  input: { color: colors.brand.textPrimary, fontSize: fontSizes.body },
  errorText: { fontSize: fontSizes.small, color: colors.danger, marginTop: 2 },

  // Chips
  chipScroll: { marginTop: 4 },
  chipRow: { flexDirection: 'row', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.brand.bgSurface,
  },
  chipActive: { backgroundColor: colors.brand.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.brand.textSecondary },
  chipTextActive: { color: colors.white },

  // Contacts
  contactsList: {
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.gap12,
    height: 44,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(0,0,0,0.07)',
    gap: spacing.gap12,
  },
  checkbox: {
    width: 18, height: 18, borderRadius: 5,
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  contactAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.brand.light,
    justifyContent: 'center', alignItems: 'center',
  },
  contactAvatarText: { fontSize: 11, fontWeight: '700', color: colors.brand.primary },
  contactInfo: { flex: 1 },
  contactName: { fontSize: fontSizes.caption, fontWeight: '600', color: colors.brand.textPrimary },
  contactSub: { fontSize: fontSizes.small, color: colors.brand.textSecondary },
  emptyContacts: {
    padding: spacing.gap12,
    backgroundColor: colors.brand.bgSurface,
    borderRadius: 10,
  },
  emptyContactsText: { fontSize: fontSizes.caption, color: colors.brand.textSecondary },

  // Start button
  startBtn: {
    height: spacing.buttonHeight,
    borderRadius: 13,
    backgroundColor: colors.brand.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startBtnDisabled: { opacity: 0.5 },
  startBtnPressed: { opacity: 0.85 },
  startBtnText: { color: colors.white, fontSize: fontSizes.button, fontWeight: '700' },
});

export default StartTripModal;

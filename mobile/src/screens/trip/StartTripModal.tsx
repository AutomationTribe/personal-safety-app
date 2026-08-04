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
import * as Location from 'expo-location';
import { supabase } from '../../lib/supabase';
import { getContacts, TrustedContact } from '../../services/CircleService';
import { startTracking, attachTrip, isTracking } from '../../services/LocationService';
import { colors } from '../../styles/tokens';

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
  destination_lat: number | null;
  destination_lng: number | null;
  contact_ids: string[];
  created_at: string;
}

const DEFAULT_STOP_THRESHOLD_MINUTES = 10;

interface Props {
  visible: boolean;
  onClose: () => void;
  onTripStarted: (trip: Trip) => void;
}

type NotifyMode = 'all' | 'select';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

// ── Component ─────────────────────────────────────────────────────────────────

const StartTripModal = ({ visible, onClose, onTripStarted }: Props) => {
  const destRef = useRef<TextInput>(null);

  const [destination, setDestination] = useState('');
  const [expectedDuration, setExpectedDuration] = useState('');
  const [stopThreshold, setStopThreshold] = useState(String(DEFAULT_STOP_THRESHOLD_MINUTES));
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [notifyMode, setNotifyMode] = useState<NotifyMode>('all');
  const [autoSos, setAutoSos] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [starting, setStarting] = useState(false);
  const [errors, setErrors] = useState<{ destination?: string; contacts?: string; duration?: string; stopThreshold?: string }>({});

  useEffect(() => {
    if (!visible) return;
    setDestination('');
    setExpectedDuration('');
    setStopThreshold(String(DEFAULT_STOP_THRESHOLD_MINUTES));
    setNotifyMode('all');
    setAutoSos(true);
    setErrors({});
    setStarting(false);
    setLoadingContacts(true);
    getContacts().then((data) => {
      setContacts(data);
      setSelectedIds(new Set(data.map((c) => c.id)));
      setLoadingContacts(false);
    });
    setTimeout(() => destRef.current?.focus(), 250);
  }, [visible]);

  function validate(): boolean {
    const next: typeof errors = {};
    if (!destination.trim() || destination.trim().length < 2) {
      next.destination = 'Enter your destination.';
    }
    const durationNum = Number(expectedDuration);
    if (!expectedDuration.trim() || !Number.isFinite(durationNum) || durationNum <= 0) {
      next.duration = 'Enter expected duration in minutes.';
    }
    const thresholdNum = Number(stopThreshold);
    if (!stopThreshold.trim() || !Number.isFinite(thresholdNum) || thresholdNum <= 0) {
      next.stopThreshold = 'Enter a stop threshold in minutes.';
    }
    if (selectedIds.size === 0) {
      next.contacts = 'Select at least one contact to alert.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  const setAllContacts = () => {
    setNotifyMode('all');
    setSelectedIds(new Set(contacts.map((c) => c.id)));
    setErrors((e) => ({ ...e, contacts: undefined }));
  };

  const setCustomContacts = () => {
    setNotifyMode('select');
    setErrors((e) => ({ ...e, contacts: undefined }));
  };

  const toggleContact = (id: string) => {
    setNotifyMode('select');
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

      // Best-effort geocode for arrival detection — a failed/ambiguous
      // geocode just means arrival detection won't fire for this trip;
      // it never blocks trip creation.
      let destinationLat: number | null = null;
      let destinationLng: number | null = null;
      try {
        const [geo] = await Location.geocodeAsync(destination.trim());
        if (geo) {
          destinationLat = geo.latitude;
          destinationLng = geo.longitude;
        }
      } catch {
        // non-fatal
      }

      const origin = 'Current location';
      const { data, error } = await supabase
        .from('trips')
        .insert({
          user_id: session.user.id,
          status: 'active',
          origin,
          destination: destination.trim(),
          destination_lat: destinationLat,
          destination_lng: destinationLng,
          started_at: new Date().toISOString(),
          expected_duration_minutes: Number(expectedDuration),
          expected_stops: 0,
          max_stop_duration_minutes: Number(stopThreshold),
          contact_ids: Array.from(selectedIds),
        })
        .select()
        .single();

      if (error || !data) throw new Error(error?.message ?? 'Failed to create trip');

      const trip = data as Trip;

      // Always Online may already be tracking (general.md: "user can set a
      // trip when in always on mode") — attach this trip to the running
      // session instead of trying to start a second one.
      if (isTracking()) {
        attachTrip(trip.id);
      } else {
        await startTracking(trip.id, 30, 'continuous');
      }

      if (session.access_token) {
        fetch(`${BACKEND_URL}/api/v1/trips/notify-start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            tripId: trip.id,
            origin,
            destination: destination.trim(),
            expectedDurationMinutes: Number(expectedDuration),
            autoSos,
            contactIds: Array.from(selectedIds),
          }),
        }).catch(() => {});
      }

      onTripStarted(trip);
      onClose();
    } catch (err) {
      setErrors({ destination: err instanceof Error ? err.message : 'Could not add trip. Try again.' });
    } finally {
      setStarting(false);
    }
  };

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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.dismissArea} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Add a Trip</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Feather name="x" size={24} color="#111827" />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Destination</Text>
              <View style={[styles.inputBox, errors.destination && styles.inputError]}>
                <Feather name="map-pin" size={22} color="#374151" />
                <TextInput
                  ref={destRef}
                  style={styles.input}
                  value={destination}
                  onChangeText={(text) => {
                    setDestination(text);
                    setErrors((e) => ({ ...e, destination: undefined }));
                  }}
                  placeholder="Where are you going?"
                  placeholderTextColor="#6B7280"
                  autoCapitalize="words"
                  returnKeyType="next"
                  editable={!starting}
                />
              </View>
              {errors.destination ? <Text style={styles.errorText}>{errors.destination}</Text> : null}
            </View>

            <View style={styles.durationRow}>
              <View style={[styles.fieldGroup, styles.durationField]}>
                <Text style={styles.label}>Expected duration (min)</Text>
                <View style={[styles.inputBox, errors.duration && styles.inputError]}>
                  <Feather name="clock" size={20} color="#374151" />
                  <TextInput
                    style={styles.input}
                    value={expectedDuration}
                    onChangeText={(text) => {
                      setExpectedDuration(text.replace(/[^0-9]/g, ''));
                      setErrors((e) => ({ ...e, duration: undefined }));
                    }}
                    placeholder="e.g. 90"
                    placeholderTextColor="#6B7280"
                    keyboardType="number-pad"
                    returnKeyType="next"
                    editable={!starting}
                  />
                </View>
                {errors.duration ? <Text style={styles.errorText}>{errors.duration}</Text> : null}
              </View>

              <View style={[styles.fieldGroup, styles.durationField]}>
                <Text style={styles.label}>Stop threshold (min)</Text>
                <View style={[styles.inputBox, errors.stopThreshold && styles.inputError]}>
                  <Feather name="pause-circle" size={20} color="#374151" />
                  <TextInput
                    style={styles.input}
                    value={stopThreshold}
                    onChangeText={(text) => {
                      setStopThreshold(text.replace(/[^0-9]/g, ''));
                      setErrors((e) => ({ ...e, stopThreshold: undefined }));
                    }}
                    placeholder={String(DEFAULT_STOP_THRESHOLD_MINUTES)}
                    placeholderTextColor="#6B7280"
                    keyboardType="number-pad"
                    returnKeyType="done"
                    editable={!starting}
                  />
                </View>
                {errors.stopThreshold ? <Text style={styles.errorText}>{errors.stopThreshold}</Text> : null}
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Notify Circle</Text>
              <View style={styles.notifyRow}>
                <Pressable
                  style={[styles.notifyBtn, notifyMode === 'all' && styles.notifyBtnActive]}
                  onPress={setAllContacts}
                  disabled={starting || loadingContacts}
                >
                  <Feather name="users" size={19} color={notifyMode === 'all' ? '#E91E63' : '#374151'} />
                  <Text style={[styles.notifyText, notifyMode === 'all' && styles.notifyTextActive]}>All</Text>
                </Pressable>
                <Pressable
                  style={[styles.notifyBtn, notifyMode === 'select' && styles.notifyBtnActive]}
                  onPress={setCustomContacts}
                  disabled={starting}
                >
                  <Feather name="user-plus" size={20} color={notifyMode === 'select' ? '#E91E63' : '#374151'} />
                  <Text style={[styles.notifyText, notifyMode === 'select' && styles.notifyTextActive]}>Select</Text>
                </Pressable>
              </View>
              {errors.contacts ? <Text style={styles.errorText}>{errors.contacts}</Text> : null}
            </View>

            {notifyMode === 'select' ? (
              <View style={styles.contactsPanel}>
                {loadingContacts ? (
                  <ActivityIndicator color="#4B0082" />
                ) : contacts.length === 0 ? (
                  <Text style={styles.emptyContactsText}>Add contacts to your circle first.</Text>
                ) : (
                  contacts.map((contact) => {
                    const selected = selectedIds.has(contact.id);
                    return (
                      <Pressable
                        key={contact.id}
                        style={styles.contactRow}
                        onPress={() => toggleContact(contact.id)}
                        disabled={starting}
                      >
                        <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
                          {selected ? <Feather name="check" size={12} color="#FFFFFF" /> : null}
                        </View>
                        <Text style={styles.contactName} numberOfLines={1}>{contact.name}</Text>
                        <Text style={styles.contactMeta} numberOfLines={1}>{contact.relationship}</Text>
                      </Pressable>
                    );
                  })
                )}
              </View>
            ) : null}

            <View style={styles.autoRow}>
              <View>
                <Text style={styles.autoTitle}>Auto SOS</Text>
                <Text style={styles.autoSub}>trigger sos automatically</Text>
              </View>
              <Pressable
                style={[styles.switchTrack, autoSos && styles.switchTrackOn]}
                onPress={() => setAutoSos((value) => !value)}
                disabled={starting}
              >
                <View style={[styles.switchKnob, autoSos && styles.switchKnobOn]} />
              </Pressable>
            </View>

            <View style={styles.tripModeCard}>
              <View style={styles.tripModeAccent} />
              <Feather name="shield" size={24} color="#5B00A5" />
              <View style={styles.tripModeTextBlock}>
                <Text style={styles.tripModeTitle}>Trip Mode</Text>
                <Text style={styles.tripModeSub}>
                  Safety contacts will be notified if you don't arrive by the ETA.
                </Text>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.addBtn,
                starting && styles.addBtnDisabled,
                pressed && !starting && styles.addBtnPressed,
              ]}
              onPress={handleStart}
              disabled={starting}
            >
              {starting ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Text style={styles.addBtnText}>Add Trip</Text>
                  <Feather name="arrow-right" size={24} color="#FFFFFF" />
                </>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.58)',
    justifyContent: 'flex-end',
  },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '82%',
    paddingTop: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 28,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C7C9D1',
    marginBottom: 13,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 26,
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flexGrow: 0 },
  scrollContent: {
    paddingHorizontal: 26,
    paddingBottom: 33,
    gap: 21,
  },
  fieldGroup: { gap: 10 },
  durationRow: { flexDirection: 'row', gap: 14 },
  durationField: { flex: 1 },
  label: {
    fontSize: 13,
    fontWeight: '800',
    color: '#3F3F46',
  },
  inputBox: {
    height: 46,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#C7CDDB',
    backgroundColor: '#EEF3FF',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  inputError: {
    borderColor: '#DC2626',
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    paddingVertical: 0,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DC2626',
  },
  notifyRow: {
    flexDirection: 'row',
    gap: 10,
  },
  notifyBtn: {
    flex: 1,
    height: 43,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C7CDDB',
    backgroundColor: '#EEF3FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  notifyBtnActive: {
    borderWidth: 2,
    borderColor: '#E91E63',
  },
  notifyText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
  },
  notifyTextActive: {
    color: '#E91E63',
  },
  contactsPanel: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D8DEEC',
    backgroundColor: '#F8FAFF',
    overflow: 'hidden',
  },
  contactRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E9F3',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#4B0082',
    borderColor: '#4B0082',
  },
  contactName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
  contactMeta: {
    maxWidth: 100,
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
  },
  emptyContactsText: {
    padding: 12,
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textAlign: 'center',
  },
  autoRow: {
    minHeight: 55,
    borderRadius: 8,
    backgroundColor: '#EEF3FF',
    borderWidth: 1,
    borderColor: '#D7DEEF',
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  autoTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  autoSub: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    color: '#111827',
  },
  switchTrack: {
    width: 40,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#CBD5E1',
    padding: 3,
    justifyContent: 'center',
  },
  switchTrackOn: {
    backgroundColor: '#E91E63',
  },
  switchKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
  },
  switchKnobOn: {
    transform: [{ translateX: 16 }],
  },
  tripModeCard: {
    minHeight: 69,
    borderRadius: 8,
    backgroundColor: '#E6EEFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 12,
    gap: 14,
    overflow: 'hidden',
  },
  tripModeAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: '#5B00A5',
  },
  tripModeTextBlock: { flex: 1 },
  tripModeTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  tripModeSub: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 14,
  },
  addBtn: {
    height: 48,
    borderRadius: 8,
    backgroundColor: '#5B008F',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#111827',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  addBtnDisabled: { opacity: 0.6 },
  addBtnPressed: { opacity: 0.86 },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
});

export default StartTripModal;

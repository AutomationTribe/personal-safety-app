import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStackParamList } from '../../navigation/AppNavigator';
import { supabase } from '../../lib/supabase';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import {
  stopTracking,
  startTracking,
  detachTrip,
  setPositionListener,
  getLastPing,
  haversineMetres,
  getAccurateFix,
  isAccurateEnough,
  LocationPing,
} from '../../services/LocationService';
import { triggerSOS, triggerSilentSOS, cancelSOS, syncQueuedSOS, SOSContact } from '../../services/SOSService';
import { startSOSRecording, stopSOSRecording } from '../../services/SOSAudioService';
import { getContacts } from '../../services/CircleService';
import { startBatteryMonitor, stopBatteryMonitor } from '../../services/BatteryMonitor';
import { notifyTrackingPaused } from '../../services/NotificationService';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import StartTripModal, { Trip } from './StartTripModal';
import SuccessToast from '../../components/SuccessToast';
import HadinLogo from '../../components/HadinLogo';
import FakeCallSetupSheet from '../fakecall/FakeCallSetupSheet';
import { displayIncomingFakeCall, ensureFakeCallPermissions } from '../../services/FakeCallKeepService';

// ── AsyncStorage keys ─────────────────────────────────────────────────────────

const SETUP_GPS_KEY = 'HADIN_SETUP_GPS';
const SETUP_AUDIO_KEY = 'HADIN_SETUP_AUDIO';
const SOS_PIN_KEY = 'HADIN_SOS_PIN';
const USER_MODE_KEY = 'HADIN_USER_MODE';

// Detector thresholds (Trip Mode stop/arrival detection — see flows/mobile/user-mode.md)
const STOP_RADIUS_METRES = 50;
const ARRIVAL_RADIUS_METRES = 50;
const ARRIVAL_DEBOUNCE_MS = 30_000;
const AREYOUOKAY_TIMEOUT_MS = 60_000;
const ARRIVAL_AUTO_END_MS = 5 * 60_000;
// Configurable per-user in Settings in a future pass (flows/fixes.md) — 15
// minutes for now.
const ALWAYS_ONLINE_INTERVAL_MINUTES = 15;
const TRIP_INTERVAL_MINUTES = 30;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Contact {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
}

interface CircleContact extends SOSContact {
  relationship?: string | null;
}

interface FamilyGroup {
  id: string;
  name: string;
  member_count: number;
}

type SetupStep = 'gps' | 'audio' | 'pin';
type UserMode = 'always_on' | 'trip';
type UserPlan = 'basic' | 'elite';

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0] ?? fullName;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

// Prefer a street-level line (number + street, or a named place) over just
// city/region — reverseGeocodeAsync returns both, but city/region alone
// reads as a vague area even when the underlying GPS fix is accurate.
function streetLevelLabel(addr: Location.LocationGeocodedAddress): string {
  const streetLine = [addr.streetNumber, addr.street].filter(Boolean).join(' ');
  const line1 = streetLine || addr.name || null;
  const line2 = addr.city ?? addr.subregion ?? addr.region ?? null;
  // Dedupe in case `name` and `city` resolve to the same string.
  const parts = [...new Set([line1, line2].filter((p): p is string => !!p))];
  return parts.join(', ') || 'Current location';
}

const AVATAR_PALETTE = [
  { bg: '#E6F1FB', fg: '#0C447C' },
  { bg: '#EAF3DE', fg: '#27500A' },
  { bg: '#EEEDFE', fg: '#3C3489' },
  { bg: '#FAEEDA', fg: '#633806' },
  { bg: '#E1F5EE', fg: '#085041' },
  { bg: '#EFF9F4', fg: '#1A6B4A' },
];

function avatarColors(index: number) {
  return AVATAR_PALETTE[index % AVATAR_PALETTE.length];
}

const NIGERIA_DEFAULT = {
  latitude: 6.524,
  longitude: 3.379,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

const SOS_COUNTDOWN_SECONDS = 20;

function coordsFromPing(ping: LocationPing): string {
  return `${Math.abs(ping.lat).toFixed(4)}° ${ping.lat >= 0 ? 'N' : 'S'}, ${Math.abs(ping.lng).toFixed(4)}° ${ping.lng >= 0 ? 'E' : 'W'}`;
}

// ── HomeScreen ────────────────────────────────────────────────────────────────

const HomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { isOnline } = useNetworkStatus();

  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');
  const [userPlan, setUserPlan] = useState<UserPlan>('basic');
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [recentTrips, setRecentTrips] = useState<Trip[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [familyGroups, setFamilyGroups] = useState<FamilyGroup[]>([]);
  const [lastPing, setLastPing] = useState<LocationPing | null>(null);
  const [loading, setLoading] = useState(true);
  const [locationGranted, setLocationGranted] = useState(true);
  const [showStartModal, setShowStartModal] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; title: string; subtitle?: string; duration?: number }>({ visible: false, title: '' });

  // SOS state
  const [sosLoading, setSosLoading] = useState(false);
  const [sosActive, setSosActive] = useState(false);
  const [sosEventId, setSosEventId] = useState<string | undefined>();
  const [sosTime, setSosTime] = useState<string | undefined>();
  const [sosNotified, setSosNotified] = useState(0);
  const [sosTotal, setSosTotal] = useState(0);
  const [tripContacts, setTripContacts] = useState<CircleContact[]>([]);
  const [showEndModal, setShowEndModal] = useState(false);
  const [showSOSCountdown, setShowSOSCountdown] = useState(false);
  const [showSOSCancelPin, setShowSOSCancelPin] = useState(false);
  const [cancelPinInput, setCancelPinInput] = useState('');
  const [cancelPinError, setCancelPinError] = useState('');

  // Setup checklist state
  const [setupStep, setSetupStep] = useState<SetupStep | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinFirst, setPinFirst] = useState('');
  const [pinStage, setPinStage] = useState<'enter' | 'confirm'>('enter');
  const [pinError, setPinError] = useState('');

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id ?? '';

      const [activeTripRes, recentRes, contactsRes, tripContactsRes, profileRes, activeSosRes] = await Promise.all([
        supabase.from('trips').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('trips').select('*').neq('status', 'active').order('created_at', { ascending: false }).limit(3),
        supabase.from('trusted_contacts').select('id, name, phone, relationship').order('created_at', { ascending: true }).limit(2),
        supabase.from('trusted_contacts').select('id, name, phone, relationship').order('created_at', { ascending: true }),
        supabase.from('profiles').select('plan, subscription_status').eq('id', userId).maybeSingle(),
        supabase.from('sos_events').select('id, triggered_at, contacts_total, contacts_notified')
          .eq('user_id', userId).is('cancelled_at', null).is('resolved_at', null)
          .order('triggered_at', { ascending: false }).limit(1).maybeSingle(),
      ]);

      const meta = user?.user_metadata as { full_name?: string } | undefined;
      setUserId(userId);
      setUserName(meta?.full_name ?? user?.email ?? '');
      setActiveTrip((activeTripRes.data as Trip | null) ?? null);
      setRecentTrips((recentRes.data as Trip[]) ?? []);
      setContacts((contactsRes.data as Contact[]) ?? []);
      setTripContacts((tripContactsRes.data ?? []) as CircleContact[]);

      // Restore an SOS that's still active (not cancelled/resolved) — e.g.
      // the app was killed and reopened while help is still on the way.
      const activeSos = activeSosRes.data as {
        id: string; triggered_at: string; contacts_total: number; contacts_notified: number;
      } | null;
      if (activeSos) {
        setSosActive(true);
        setSosEventId(activeSos.id);
        setSosTime(formatTime(activeSos.triggered_at));
        setSosNotified(activeSos.contacts_notified);
        setSosTotal(activeSos.contacts_total);
        void startSOSRecording(activeSos.id);
      }

      const profileData = profileRes.data as { plan?: string; subscription_status?: string } | null;
      // Trial is treated as Elite-equivalent for Always Online gating (flows/mobile/dashboard.md).
      const plan: UserPlan =
        profileData?.plan === 'elite' || profileData?.subscription_status === 'trial'
          ? 'elite'
          : 'basic';
      setUserPlan(plan);

      // Fetch family groups for elite users (silent failure if table missing)
      if (plan === 'elite' && userId) {
        try {
          const { data } = await supabase
            .from('family_groups')
            .select('id, name, member_count')
            .eq('owner_id', userId)
            .order('created_at', { ascending: true })
            .limit(2);
          setFamilyGroups((data as FamilyGroup[]) ?? []);
        } catch {
          setFamilyGroups([]);
        }
      }

      const ping = await getLastPing();
      setLastPing(ping);
    } catch {
      // Non-fatal — UI shows empty states
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Check location permission
  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then(({ status }) => setLocationGranted(status === 'granted'))
      .catch(() => null);
  }, []);

  // Sync any SQLite-queued offline SOS events as soon as connectivity returns.
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) {
      void syncQueuedSOS();
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline]);

  // Realtime: watch trips table for status changes
  useEffect(() => {
    const channel = supabase
      .channel(`home-trips-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => { loadData(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  // Setup checklist check (runs after data loads)
  const checkSetupSteps = useCallback(async () => {
    // Step 1: GPS
    const gpsSetup = await AsyncStorage.getItem(SETUP_GPS_KEY).catch(() => null);
    if (!gpsSetup) {
      const { status } = await Location.getForegroundPermissionsAsync().catch(() => ({ status: 'denied' as const }));
      if (status === 'granted') {
        await AsyncStorage.setItem(SETUP_GPS_KEY, 'done').catch(() => null);
      } else {
        setSetupStep('gps');
        return;
      }
    }

    // Step 2: Audio
    const audioSetup = await AsyncStorage.getItem(SETUP_AUDIO_KEY).catch(() => null);
    if (!audioSetup) {
      setSetupStep('audio');
      return;
    }

    // Step 3: SOS PIN
    const pin = await AsyncStorage.getItem(SOS_PIN_KEY).catch(() => null);
    if (!pin) {
      setSetupStep('pin');
      return;
    }

    setSetupStep(null);
  }, []);

  useEffect(() => {
    if (!loading) {
      checkSetupSteps();
    }
  }, [loading, checkSetupSteps]);

  // tripContacts is trip-specific — clear it once the trip ends. SOS state
  // is intentionally NOT reset here: SOS can be active with no trip at all
  // (idle-dashboard trigger), and a trip ending must never silently hide an
  // still-active SOS — only an explicit cancel/resolve does that.
  useEffect(() => {
    if (!activeTrip) {
      setTripContacts([]);
    }
  }, [activeTrip]);

  // ── Setup step handlers ──────────────────────────────────────────────────────

  const handleGpsEnable = async () => {
    await Linking.openSettings().catch(() => null);
    // Re-check permission after user returns from settings
    const { status } = await Location.getForegroundPermissionsAsync().catch(() => ({ status: 'denied' as const }));
    if (status === 'granted') {
      await AsyncStorage.setItem(SETUP_GPS_KEY, 'done').catch(() => null);
      setLocationGranted(true);
      await checkSetupSteps();
    }
  };

  const handleAudioEnable = async () => {
    const { status } = await Audio.requestPermissionsAsync().catch(() => ({ status: 'denied' as const }));
    if (status !== 'granted') {
      // Already denied once (or restricted) — only Settings can grant it now.
      await Linking.openSettings().catch(() => null);
    }
    await AsyncStorage.setItem(SETUP_AUDIO_KEY, 'done').catch(() => null);
    await checkSetupSteps();
  };

  const handleAudioSkip = async () => {
    await AsyncStorage.setItem(SETUP_AUDIO_KEY, 'skipped').catch(() => null);
    await checkSetupSteps();
  };

  const handleSetupCancel = () => {
    setSetupStep(null);
  };

  const handlePinDigit = async (digit: string) => {
    const next = pinInput + digit;
    setPinInput(next);
    setPinError('');

    if (next.length < 4) return;

    if (pinStage === 'enter') {
      setPinFirst(next);
      setPinInput('');
      setPinStage('confirm');
    } else {
      if (next === pinFirst) {
        await AsyncStorage.setItem(SOS_PIN_KEY, next).catch(() => null);
        setPinInput('');
        setPinFirst('');
        setPinStage('enter');
        await checkSetupSteps();
      } else {
        setPinError("PINs don't match — try again");
        setPinInput('');
        setPinStage('enter');
        setPinFirst('');
      }
    }
  };

  const handlePinBackspace = () => {
    setPinInput((p) => p.slice(0, -1));
    setPinError('');
  };

  // ── Trip actions ────────────────────────────────────────────────────────────

  const handleStartTrip = async () => {
    const circle = await getContacts();
    if (circle.length === 0) {
      Alert.alert(
        'Add contacts first',
        'You need at least one person in your circle before starting a trip.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Go to Circle', onPress: () => navigation.navigate('Circle') },
        ],
      );
      return;
    }
    setShowStartModal(true);
  };

  const handleTripStarted = (trip: Trip) => {
    setActiveTrip(trip);
    setToast({ visible: true, title: 'Trip successfully added' });
  };

  const handleIdleSOS = () => {
    setShowSOSCountdown(true);
  };

  const handleEndTrip = () => {
    if (!activeTrip) return;
    setShowEndModal(true);
  };

  const confirmEndTrip = async () => {
    if (!activeTrip) return;
    setShowEndModal(false);
    setShowArrival(false);
    const endedTrip = activeTrip;
    const endedAt = new Date().toISOString();
    try {
      await supabase.from('trips').update({ status: 'completed', ended_at: endedAt }).eq('id', endedTrip.id);

      // If Always Online is still selected (and the plan still allows it),
      // keep that tracking session running — just untag this trip from it
      // instead of stopping tracking outright.
      const savedMode = userId
        ? await AsyncStorage.getItem(`${USER_MODE_KEY}:${userId}`).catch(() => null)
        : null;
      if (savedMode === 'always_on' && userPlan !== 'basic') {
        detachTrip();
      } else {
        await stopTracking();
      }

      setActiveTrip(null);
      setSosActive(false);
      setSosEventId(undefined);
      setTripSummary({ ...endedTrip, ended_at: endedAt, status: 'completed' });
      await loadData();
    } catch {
      Alert.alert('Error', 'Could not end trip');
    }
  };

  // ── Stop-too-long / arrival detection (Trip Mode only) ──────────────────────
  // Separate, lightweight foreground watcher purely for these two UX
  // detectors — deliberately NOT the battery-optimized 30-min ping cadence
  // LocationService already owns (see flows/mobile/user-mode.md). Stops the
  // instant the trip ends.

  const [showAreYouOkay, setShowAreYouOkay] = useState(false);
  const [showArrival, setShowArrival] = useState(false);
  const [tripSummary, setTripSummary] = useState<Trip | null>(null);

  const stopAnchorRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastMovedAtRef = useRef<number>(Date.now());
  const arrivedSinceRef = useRef<number | null>(null);
  const detectorSubRef = useRef<Location.LocationSubscription | null>(null);
  const areYouOkayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrivalAutoEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sosActiveRef = useRef(false);

  useEffect(() => { sosActiveRef.current = sosActive; }, [sosActive]);

  useEffect(() => {
    if (!activeTrip) return;

    stopAnchorRef.current = null;
    lastMovedAtRef.current = Date.now();
    arrivedSinceRef.current = null;
    setShowAreYouOkay(false);
    setShowArrival(false);

    const thresholdMs = Math.max(1, activeTrip.max_stop_duration_minutes) * 60_000;
    const destLat = activeTrip.destination_lat;
    const destLng = activeTrip.destination_lng;

    Location.getForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 5000, distanceInterval: 10 },
        (pos) => {
          if (sosActiveRef.current) return;
          const { latitude, longitude } = pos.coords;
          const now = Date.now();

          // Keep the map / "Current Location" label live — this detector
          // watcher already runs at ~60s cadence for stop/arrival checks,
          // so piggyback on it instead of starting a second GPS watcher.
          // Never centre the map on (or store) a low-accuracy fix.
          if (isAccurateEnough(pos.coords.accuracy)) {
            setLastPing({
              tripId: activeTrip.id,
              lat: latitude,
              lng: longitude,
              accuracy: pos.coords.accuracy,
              speed: pos.coords.speed,
              heading: pos.coords.heading,
              timestamp: new Date(pos.timestamp).toISOString(),
              source: 'gps',
              synced: false,
            });
          }

          // Stop-too-long
          if (!stopAnchorRef.current) {
            stopAnchorRef.current = { lat: latitude, lng: longitude };
            lastMovedAtRef.current = now;
          } else if (haversineMetres(stopAnchorRef.current.lat, stopAnchorRef.current.lng, latitude, longitude) > STOP_RADIUS_METRES) {
            stopAnchorRef.current = { lat: latitude, lng: longitude };
            lastMovedAtRef.current = now;
          } else if (now - lastMovedAtRef.current >= thresholdMs) {
            setShowAreYouOkay(true);
          }

          // Arrival
          if (destLat != null && destLng != null) {
            const distToDest = haversineMetres(latitude, longitude, destLat, destLng);
            if (distToDest <= ARRIVAL_RADIUS_METRES) {
              if (arrivedSinceRef.current === null) {
                arrivedSinceRef.current = now;
              } else if (now - arrivedSinceRef.current >= ARRIVAL_DEBOUNCE_MS) {
                setShowArrival(true);
              }
            } else {
              arrivedSinceRef.current = null;
            }
          }
        },
      ).then((sub) => { detectorSubRef.current = sub; }).catch(() => null);
    }).catch(() => null);

    return () => {
      detectorSubRef.current?.remove();
      detectorSubRef.current = null;
    };
  }, [activeTrip]);

  // "Are you okay?" — 60s no-response auto-escalates to a silent (level-2) alert.
  useEffect(() => {
    if (!showAreYouOkay) return;
    areYouOkayTimerRef.current = setTimeout(() => {
      setShowAreYouOkay(false);
      stopAnchorRef.current = null;
      lastMovedAtRef.current = Date.now();
      if (activeTrip) {
        triggerSilentSOS(activeTrip.id).then((r) => {
          if (r.success) {
            setToast({ visible: true, title: 'Checked in with monitoring', subtitle: "You didn't respond in time", duration: 4000 });
          }
        });
      }
    }, AREYOUOKAY_TIMEOUT_MS);
    return () => {
      if (areYouOkayTimerRef.current) clearTimeout(areYouOkayTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAreYouOkay]);

  const handleAreYouOkayConfirm = () => {
    setShowAreYouOkay(false);
    stopAnchorRef.current = null;
    lastMovedAtRef.current = Date.now();
  };

  const handleAreYouOkaySOS = () => {
    setShowAreYouOkay(false);
    setShowSOSCountdown(true);
  };

  // Arrival — 5 min no-response auto-ends the trip silently.
  useEffect(() => {
    if (!showArrival) return;
    arrivalAutoEndTimerRef.current = setTimeout(() => {
      setShowArrival(false);
      void confirmEndTrip();
    }, ARRIVAL_AUTO_END_MS);
    return () => {
      if (arrivalAutoEndTimerRef.current) clearTimeout(arrivalAutoEndTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArrival]);

  const handleArrivalConfirm = () => {
    setShowArrival(false);
    void confirmEndTrip();
  };

  const handleArrivalDismiss = () => {
    setShowArrival(false);
    arrivedSinceRef.current = null;
  };

  // ── SOS handlers ────────────────────────────────────────────────────────────

  const handleSOSTap = async () => {
    if (sosLoading || sosActive) return;
    setSosLoading(true);
    const firedAt = new Date();
    const result = await triggerSOS(activeTrip?.id ?? null, activeTrip?.contact_ids ?? []);
    setSosLoading(false);
    const timeStr = formatTime(firedAt.toISOString());
    setSosTime(timeStr);
    setSosNotified(result.notified);
    setSosTotal(result.total > 0 ? result.total : tripContacts.length);
    if (result.success) {
      setSosActive(true);
      setSosEventId(result.eventId);
      if (result.eventId) void startSOSRecording(result.eventId);
    } else {
      setSosActive(false);
      setToast({
        visible: true,
        title: result.offline ? 'No internet — SOS sent via SMS to your circle' : 'SOS sent via SMS',
        duration: 4000,
      });
    }
  };

  const handleSOSCountdownConfirm = async () => {
    await handleSOSTap();
    return true;
  };

  // "Cancel SOS" never cancels directly — it opens the PIN-entry sheet.
  const handleCancelSOS = () => {
    setCancelPinInput('');
    setCancelPinError('');
    setShowSOSCancelPin(true);
  };

  const confirmCancelSOSWithPin = async () => {
    // Must be awaited — the final audio chunk's upload has to complete
    // before the user can navigate to the SOS detail screen, otherwise its
    // one-time Storage `list()` call finds nothing yet (looks like the
    // recording never happened).
    await stopSOSRecording();
    if (!sosEventId) {
      setSosActive(false);
      setSosTime(undefined);
      return;
    }
    const result = await cancelSOS(sosEventId);
    if (result.success) {
      setSosActive(false);
      setSosEventId(undefined);
      setSosTime(undefined);
      setSosNotified(0);
      setSosTotal(0);
    } else {
      console.warn('[SOS] Cancel failed:', result.error);
    }
  };

  const handleCancelPinDigit = async (digit: string) => {
    const next = cancelPinInput + digit;
    setCancelPinInput(next);
    setCancelPinError('');

    if (next.length < 4) return;

    const savedPin = await AsyncStorage.getItem(SOS_PIN_KEY).catch(() => null);
    if (savedPin && next === savedPin) {
      setShowSOSCancelPin(false);
      setCancelPinInput('');
      await confirmCancelSOSWithPin();
    } else {
      setCancelPinError('Incorrect pin. Try again.');
      setCancelPinInput('');
    }
  };

  const handleCancelPinBackspace = () => {
    setCancelPinInput((p) => p.slice(0, -1));
    setCancelPinError('');
  };

  // No dedicated reset flow exists yet — the practical path is re-creating
  // the PIN via the same first-login setup modal already built for it.
  const handleForgotSOSPin = async () => {
    setShowSOSCancelPin(false);
    setCancelPinInput('');
    setCancelPinError('');
    await AsyncStorage.removeItem(SOS_PIN_KEY).catch(() => null);
    setSetupStep('pin');
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4B0082" />
      </View>
    );
  }

  if (activeTrip) {
    return (
      <>
        <SuccessToast
          visible={toast.visible}
          title={toast.title}
          subtitle={toast.subtitle}
          duration={toast.duration}
          onHide={() => setToast((t) => ({ ...t, visible: false }))}
        />
        <ActiveTripView
          trip={activeTrip}
          tripContacts={tripContacts}
          lastPing={lastPing}
          sosLoading={sosLoading}
          sosActive={sosActive}
          sosTime={sosTime}
          sosNotified={sosNotified}
          sosTotal={sosTotal}
          onSOSTap={() => setShowSOSCountdown(true)}
          onCancelSOS={handleCancelSOS}
          onEndTrip={handleEndTrip}
          onNavigateToCircle={() => navigation.navigate('Circle')}
          onNavigateToRoutes={() => navigation.navigate('Routes')}
          onNavigateToSettings={() => navigation.navigate('Settings')}
        />
        <EndTripModal
          visible={showEndModal}
          trip={activeTrip}
          contactCount={tripContacts.length}
          onConfirm={confirmEndTrip}
          onCancel={() => setShowEndModal(false)}
        />
        <AreYouOkayModal
          visible={showAreYouOkay}
          onConfirm={handleAreYouOkayConfirm}
          onSendSOS={handleAreYouOkaySOS}
        />
        <ArrivalModal
          visible={showArrival}
          destination={activeTrip.destination}
          onConfirm={handleArrivalConfirm}
          onDismiss={handleArrivalDismiss}
        />
        <SOSCountdownOverlay
          visible={showSOSCountdown}
          currentLocation={lastPing ? coordsFromPing(lastPing) : undefined}
          onCancel={() => setShowSOSCountdown(false)}
          onConfirm={handleSOSCountdownConfirm}
          onDone={() => setShowSOSCountdown(false)}
        />
        <SOSCancelPinModal
          visible={showSOSCancelPin}
          pinInput={cancelPinInput}
          pinError={cancelPinError}
          onDigit={handleCancelPinDigit}
          onBackspace={handleCancelPinBackspace}
          onForgotPin={handleForgotSOSPin}
          onDismiss={() => setShowSOSCancelPin(false)}
        />
        <SuccessToast
          visible={!!tripSummary}
          title="Trip complete"
          subtitle={tripSummary ? `${tripSummary.destination?.trim() || 'Your trip'} ended safely` : undefined}
          duration={4000}
          onHide={() => setTripSummary(null)}
        />
      </>
    );
  }

  return (
    <>
      <SuccessToast
        visible={toast.visible}
        title={toast.title}
        subtitle={toast.subtitle}
        duration={toast.duration}
        onHide={() => setToast((t) => ({ ...t, visible: false }))}
      />
      <IdleView
        userId={userId}
        userName={userName}
        isOnline={isOnline}
        recentTrips={recentTrips}
        contacts={contacts}
        userPlan={userPlan}
        locationGranted={locationGranted}
        familyGroups={familyGroups}
        sosActive={sosActive}
        sosTime={sosTime}
        sosNotified={sosNotified}
        sosTotal={sosTotal}
        onStartTrip={handleStartTrip}
        onSOSPress={handleIdleSOS}
        onCancelSOS={handleCancelSOS}
        onNavigateToCircle={() => navigation.navigate('Circle')}
        onAddCircleMember={() => navigation.navigate('Circle', { openAddModal: true })}
        onNavigateToRoutes={() => navigation.navigate('Routes')}
        onNavigateToSettings={() => navigation.navigate('Settings')}
        onUpgrade={() => navigation.navigate('Subscription')}
      />
      <StartTripModal
        visible={showStartModal}
        onClose={() => setShowStartModal(false)}
        onTripStarted={handleTripStarted}
      />
      <SuccessToast
        visible={!!tripSummary}
        title="Trip complete"
        subtitle={tripSummary ? `${tripSummary.destination?.trim() || 'Your trip'} ended safely` : undefined}
        duration={4000}
        onHide={() => setTripSummary(null)}
      />
      <SOSCountdownOverlay
        visible={showSOSCountdown}
        currentLocation={lastPing ? coordsFromPing(lastPing) : undefined}
        onCancel={() => setShowSOSCountdown(false)}
        onConfirm={handleSOSCountdownConfirm}
        onDone={() => setShowSOSCountdown(false)}
      />
      <SOSCancelPinModal
        visible={showSOSCancelPin}
        pinInput={cancelPinInput}
        pinError={cancelPinError}
        onDigit={handleCancelPinDigit}
        onBackspace={handleCancelPinBackspace}
        onForgotPin={handleForgotSOSPin}
        onDismiss={() => setShowSOSCancelPin(false)}
      />

      {/* ── Setup checklist modals ── */}
      <SetupModal
        step={setupStep}
        pinInput={pinInput}
        pinStage={pinStage}
        pinError={pinError}
        onGpsEnable={handleGpsEnable}
        onAudioEnable={handleAudioEnable}
        onAudioSkip={handleAudioSkip}
        onCancel={handleSetupCancel}
        onPinDigit={handlePinDigit}
        onPinBackspace={handlePinBackspace}
      />
    </>
  );
};

// ── Setup checklist modal ─────────────────────────────────────────────────────

interface SetupModalProps {
  step: SetupStep | null;
  pinInput: string;
  pinStage: 'enter' | 'confirm';
  pinError: string;
  onGpsEnable: () => void;
  onAudioEnable: () => void;
  onAudioSkip: () => void;
  onCancel: () => void;
  onPinDigit: (d: string) => void;
  onPinBackspace: () => void;
}

const PIN_PAD = [['1','2','3'],['4','5','6'],['7','8','9'],['','0','⌫']] as const;

const SetupModal = ({
  step, pinInput, pinStage, pinError,
  onGpsEnable, onAudioEnable, onAudioSkip, onCancel, onPinDigit, onPinBackspace,
}: SetupModalProps) => {
  const insets = useSafeAreaInsets();
  if (!step) return null;

  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent>
      <View style={smStyles.overlay}>
        <View style={[smStyles.card, { paddingBottom: Math.max(insets.bottom, 24) }]}>

          {/* GPS step */}
          {step === 'gps' && (
            <>
              <View style={smStyles.iconCircle}>
                <Feather name="map-pin" size={28} color={colors.white} />
              </View>
              <Text style={smStyles.title}>Enable Location Access</Text>
              <Text style={smStyles.body}>
                Hadin needs your location to track trips and send your position during an SOS.
                Tap Enable to open your phone's location settings.
              </Text>
              <Pressable
                style={({ pressed }) => [smStyles.primaryBtn, pressed && smStyles.pressed]}
                onPress={onGpsEnable}
              >
                <Text style={smStyles.primaryBtnText}>Enable Location</Text>
              </Pressable>
            </>
          )}

          {/* Audio step */}
          {step === 'audio' && (
            <>
              <View style={[smStyles.iconCircle, smStyles.iconCircleAudio]}>
                <Feather name="mic" size={28} color={colors.white} />
              </View>
              <Text style={smStyles.title}>Enable Microphone Access</Text>
              <Text style={smStyles.body}>
                Microphone access allows Hadin to use voice-activated SOS and audio alerts.
                You can skip this for now.
              </Text>
              <Pressable
                style={({ pressed }) => [smStyles.primaryBtn, smStyles.audioPrimaryBtn, pressed && smStyles.pressed]}
                onPress={onAudioEnable}
              >
                <Text style={smStyles.primaryBtnText}>Enable Microphone</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [smStyles.cancelBtn, pressed && smStyles.pressed]}
                onPress={onCancel}
              >
                <Text style={smStyles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [smStyles.skipBtn, pressed && smStyles.pressed]}
                onPress={onAudioSkip}
              >
                <Text style={smStyles.skipBtnText}>Skip for now</Text>
              </Pressable>
            </>
          )}

          {/* SOS PIN step */}
          {step === 'pin' && (
            <>
              <View style={[smStyles.iconCircle, smStyles.iconCirclePin]}>
                <Feather name="shield" size={28} color={colors.white} />
              </View>
              <Text style={smStyles.title}>
                {pinStage === 'enter' ? 'Create Your SOS PIN' : 'Confirm Your PIN'}
              </Text>
              <Text style={smStyles.body}>
                {pinStage === 'enter'
                  ? 'Set a 4-digit PIN to quickly confirm safe arrival or cancel a false SOS alert.'
                  : 'Enter the same PIN again to confirm.'}
              </Text>

              {/* PIN dots */}
              <View style={smStyles.pinDots}>
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={[smStyles.pinDot, pinInput.length > i && smStyles.pinDotFilled]}
                  />
                ))}
              </View>

              {pinError ? <Text style={smStyles.pinError}>{pinError}</Text> : null}

              {/* Numpad */}
              <View style={smStyles.numpad}>
                {PIN_PAD.map((row, ri) => (
                  <View key={ri} style={smStyles.numpadRow}>
                    {row.map((key) => {
                      if (key === '') return <View key="empty" style={smStyles.numpadKey} />;
                      if (key === '⌫') {
                        return (
                          <Pressable
                            key="back"
                            style={({ pressed }) => [smStyles.numpadKey, pressed && smStyles.numpadPressed]}
                            onPress={onPinBackspace}
                          >
                            <Feather name="delete" size={20} color={colors.brand.textPrimary} />
                          </Pressable>
                        );
                      }
                      return (
                        <Pressable
                          key={key}
                          style={({ pressed }) => [smStyles.numpadKey, pressed && smStyles.numpadPressed]}
                          onPress={() => onPinDigit(key)}
                          disabled={pinInput.length >= 4}
                        >
                          <Text style={smStyles.numpadKeyText}>{key}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>

              <Pressable
                style={({ pressed }) => [smStyles.cancelBtn, smStyles.pinCancelBtn, pressed && smStyles.pressed]}
                onPress={onCancel}
              >
                <Text style={smStyles.cancelBtnText}>Cancel</Text>
              </Pressable>
            </>
          )}

        </View>
      </View>
    </Modal>
  );
};

// ── Are you okay? modal (stop-too-long detector) ───────────────────────────────

interface AreYouOkayModalProps {
  visible: boolean;
  onConfirm: () => void;
  onSendSOS: () => void;
}

const AreYouOkayModal = ({ visible, onConfirm, onSendSOS }: AreYouOkayModalProps) => (
  <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
    <View style={dmStyles.overlay}>
      <View style={dmStyles.card}>
        <View style={[dmStyles.iconWrap, dmStyles.iconWrapWarn]}>
          <Feather name="alert-triangle" size={26} color="#B45309" />
        </View>
        <Text style={dmStyles.title}>Are you okay?</Text>
        <Text style={dmStyles.body}>
          Your trip has been paused — we haven't seen you move in a while.
          If we don't hear from you in 60 seconds, monitoring will be quietly notified.
        </Text>
        <Pressable style={({ pressed }) => [dmStyles.primaryBtn, pressed && { opacity: 0.85 }]} onPress={onConfirm}>
          <Text style={dmStyles.primaryBtnText}>I'm fine — continue trip</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [dmStyles.dangerBtn, pressed && { opacity: 0.85 }]} onPress={onSendSOS}>
          <Text style={dmStyles.dangerBtnText}>Send SOS alert</Text>
        </Pressable>
      </View>
    </View>
  </Modal>
);

// ── Arrival modal (arrival detector) ────────────────────────────────────────────

interface ArrivalModalProps {
  visible: boolean;
  destination: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}

const ArrivalModal = ({ visible, destination, onConfirm, onDismiss }: ArrivalModalProps) => (
  <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onDismiss}>
    <View style={dmStyles.overlay}>
      <View style={dmStyles.card}>
        <View style={[dmStyles.iconWrap, dmStyles.iconWrapGood]}>
          <Feather name="flag" size={26} color={colors.brand.primary} />
        </View>
        <Text style={dmStyles.title}>You've arrived{destination ? ` at ${destination}` : ''}</Text>
        <Text style={dmStyles.body}>End this trip? If you don't respond, it will end automatically in 5 minutes.</Text>
        <Pressable style={({ pressed }) => [dmStyles.primaryBtn, pressed && { opacity: 0.85 }]} onPress={onConfirm}>
          <Text style={dmStyles.primaryBtnText}>End trip</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [dmStyles.linkBtn, pressed && { opacity: 0.7 }]} onPress={onDismiss}>
          <Text style={dmStyles.linkBtnText}>Not yet — keep travelling</Text>
        </Pressable>
      </View>
    </View>
  </Modal>
);

// ── SOS cancel PIN modal ─────────────────────────────────────────────────────

interface SOSCancelPinModalProps {
  visible: boolean;
  pinInput: string;
  pinError: string;
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onForgotPin: () => void;
  onDismiss: () => void;
}

const SOSCancelPinModal = ({
  visible, pinInput, pinError, onDigit, onBackspace, onForgotPin, onDismiss,
}: SOSCancelPinModalProps) => (
  <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onDismiss}>
    <View style={dmStyles.overlay}>
      <View style={dmStyles.card}>
        <View style={[dmStyles.iconWrap, dmStyles.iconWrapWarn]}>
          <Feather name="shield" size={26} color="#B45309" />
        </View>
        <Text style={dmStyles.title}>Enter your SOS PIN</Text>
        <Text style={dmStyles.body}>Confirm your PIN to cancel this SOS alert.</Text>

        <View style={smStyles.pinDots}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[smStyles.pinDot, pinInput.length > i && smStyles.pinDotFilled]} />
          ))}
        </View>

        {pinError ? <Text style={smStyles.pinError}>{pinError}</Text> : null}

        <View style={smStyles.numpad}>
          {PIN_PAD.map((row, ri) => (
            <View key={ri} style={smStyles.numpadRow}>
              {row.map((key) => {
                if (key === '') return <View key="empty" style={smStyles.numpadKey} />;
                if (key === '⌫') {
                  return (
                    <Pressable
                      key="back"
                      style={({ pressed }) => [smStyles.numpadKey, pressed && smStyles.numpadPressed]}
                      onPress={onBackspace}
                    >
                      <Feather name="delete" size={20} color={colors.brand.textPrimary} />
                    </Pressable>
                  );
                }
                return (
                  <Pressable
                    key={key}
                    style={({ pressed }) => [smStyles.numpadKey, pressed && smStyles.numpadPressed]}
                    onPress={() => onDigit(key)}
                    disabled={pinInput.length >= 4}
                  >
                    <Text style={smStyles.numpadKeyText}>{key}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        <Pressable style={({ pressed }) => [dmStyles.linkBtn, pressed && { opacity: 0.7 }]} onPress={onForgotPin}>
          <Text style={dmStyles.linkBtnText}>Forgot PIN?</Text>
        </Pressable>
      </View>
    </View>
  </Modal>
);

const dmStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  card: { width: '100%', backgroundColor: colors.white, borderRadius: 20, paddingHorizontal: 22, paddingTop: 24, paddingBottom: 10, alignItems: 'center' },
  iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  iconWrapWarn: { backgroundColor: '#FEF3C7' },
  iconWrapGood: { backgroundColor: colors.brand.light },
  title: { fontSize: 17, fontWeight: '800', color: colors.brand.textPrimary, marginBottom: 8, textAlign: 'center' },
  body: { fontSize: 13, color: colors.brand.textSecondary, textAlign: 'center', lineHeight: 19, marginBottom: 18 },
  primaryBtn: { alignSelf: 'stretch', backgroundColor: colors.brand.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 8 },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },
  dangerBtn: { alignSelf: 'stretch', backgroundColor: colors.brand.sos, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 4 },
  dangerBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },
  linkBtn: { alignItems: 'center', paddingVertical: 12 },
  linkBtnText: { fontSize: 13, color: colors.brand.textSecondary, fontWeight: '600' },
});

// ── Idle view ─────────────────────────────────────────────────────────────────

interface IdleViewProps {
  userId: string;
  userName: string;
  isOnline: boolean;
  recentTrips: Trip[];
  contacts: Contact[];
  userPlan: UserPlan;
  locationGranted: boolean;
  familyGroups: FamilyGroup[];
  sosActive: boolean;
  sosTime?: string;
  sosNotified: number;
  sosTotal: number;
  onStartTrip: () => void;
  onSOSPress: () => void;
  onCancelSOS: () => void;
  onNavigateToCircle: () => void;
  onAddCircleMember: () => void;
  onNavigateToRoutes: () => void;
  onNavigateToSettings: () => void;
  onUpgrade: () => void;
}

const IdleView = ({
  userId, userName, isOnline, recentTrips, contacts, userPlan, locationGranted, familyGroups,
  sosActive, sosTime, sosNotified, sosTotal,
  onStartTrip, onSOSPress, onCancelSOS, onNavigateToCircle, onAddCircleMember, onNavigateToRoutes, onNavigateToSettings, onUpgrade,
}: IdleViewProps) => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const visibleContacts = contacts.slice(0, 2);
  const historyItems = recentTrips.slice(0, 2);

  // User mode toggle
  const [userMode, setUserMode] = useState<UserMode>('trip');
  const [modeToggleWidth, setModeToggleWidth] = useState(0);
  const [alwaysOnRunning, setAlwaysOnRunning] = useState(false);
  const [showUpgradeSheet, setShowUpgradeSheet] = useState(false);

  // Fake call
  const [showFakeCallSheet, setShowFakeCallSheet] = useState(false);
  const [fakeCallCountdown, setFakeCallCountdown] = useState<number | null>(null);
  const fakeCallNameRef = useRef('');
  const fakeCallIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modeSlide = useRef(new Animated.Value(userMode === 'trip' ? 1 : 0)).current;
  const modeDragStart = useRef(userMode === 'trip' ? 1 : 0);
  const addTripScale = useRef(new Animated.Value(1)).current;
  const modeThumbWidth = modeToggleWidth > 0 ? (modeToggleWidth - 6) / 2 : 0;
  const modeStorageKey = userId ? `${USER_MODE_KEY}:${userId}` : null;

  const animateModeTo = useCallback((mode: UserMode) => {
    Animated.spring(modeSlide, {
      toValue: mode === 'trip' ? 1 : 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 210,
      mass: 0.8,
    }).start();
  }, [modeSlide]);

  const animateAddTrip = useCallback((toValue: number) => {
    Animated.spring(addTripScale, {
      toValue,
      useNativeDriver: true,
      speed: 30,
      bounciness: 6,
    }).start();
  }, [addTripScale]);

  const startAlwaysOnline = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        setAlwaysOnRunning(false);
        return;
      }
      setPositionListener((lat, lng) => {
        setMapRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.01, longitudeDelta: 0.01 });
      });
      await startTracking(null, ALWAYS_ONLINE_INTERVAL_MINUTES, 'interval');
      setAlwaysOnRunning(true);

      // Battery gate: pause tracking at <=15%, notify, resume automatically
      // at >20%. Note this shares the one underlying tracking session with
      // Trip Mode if a trip was attached (general.md: "user can set a trip
      // when in always on mode") — a low-battery pause here will pause that
      // trip's pings too, which is intentional (a dying phone can't send
      // SOS either way).
      await startBatteryMonitor({
        onPause: () => {
          setPositionListener(null);
          void stopTracking();
          setAlwaysOnRunning(false);
          void notifyTrackingPaused();
        },
        onResume: () => {
          void startAlwaysOnline();
        },
      });
    } catch {
      setAlwaysOnRunning(false);
    }
  }, []);

  // Restore persisted mode once we know who the user is, and resume Always
  // Online automatically if that was the last mode (and the plan still
  // allows it — a downgraded plan should not silently keep tracking).
  useEffect(() => {
    if (!modeStorageKey) return;
    AsyncStorage.getItem(modeStorageKey)
      .then(async (v) => {
        if (v !== 'always_on' && v !== 'trip') return;
        if (v === 'always_on' && userPlan === 'basic') return;
        setUserMode(v);
        if (v === 'always_on') await startAlwaysOnline();
      })
      .catch(() => null);
    return () => {
      // Don't stop tracking here — if a trip starts, StartTripModal attaches
      // it to this same session instead of restarting it (general.md: "user
      // can set a trip when in always on mode"). Just detach the map listener.
      setPositionListener(null);
    };
  }, [modeStorageKey, userPlan, startAlwaysOnline]);

  useEffect(() => {
    modeDragStart.current = userMode === 'trip' ? 1 : 0;
    animateModeTo(userMode);
  }, [animateModeTo, userMode]);

  const handleModeToggle = async (mode: UserMode) => {
    // An active SOS locks the dashboard down to "Cancel SOS" only — no mode
    // switching, no new trips, no navigating away mid-emergency.
    if (sosActive) return;
    if (mode === userMode) {
      animateModeTo(mode);
      return;
    }
    if (mode === 'always_on' && userPlan === 'basic') {
      setShowUpgradeSheet(true);
      animateModeTo(userMode);
      return;
    }

    animateModeTo(mode);
    setUserMode(mode);
    if (modeStorageKey) await AsyncStorage.setItem(modeStorageKey, mode).catch(() => null);

    if (mode === 'always_on') {
      await startAlwaysOnline();
    } else {
      setPositionListener(null);
      stopBatteryMonitor();
      await stopTracking();
      setAlwaysOnRunning(false);
    }
  };

  const modePanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => !sosActive && Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onMoveShouldSetPanResponderCapture: (_, gesture) => !sosActive && Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: () => {
      modeSlide.stopAnimation((value) => {
        modeDragStart.current = typeof value === 'number' ? value : (userMode === 'trip' ? 1 : 0);
      });
    },
    onPanResponderMove: (_, gesture) => {
      if (!modeThumbWidth) return;
      const nextValue = Math.max(0, Math.min(1, modeDragStart.current + (gesture.dx / modeThumbWidth)));
      modeSlide.setValue(nextValue);
    },
    onPanResponderRelease: (_, gesture) => {
      if (!modeThumbWidth) {
        animateModeTo(userMode);
        return;
      }
      const projectedValue = modeDragStart.current + (gesture.dx / modeThumbWidth) + (gesture.vx * 0.18);
      const nextMode: UserMode = projectedValue >= 0.5 ? 'trip' : 'always_on';
      void handleModeToggle(nextMode);
      if (nextMode === userMode) animateModeTo(nextMode);
    },
    onPanResponderTerminate: () => {
      animateModeTo(userMode);
    },
  });

  // Real GPS location for map
  const [mapRegion, setMapRegion] = useState(NIGERIA_DEFAULT);
  const [locationName, setLocationName] = useState('Detecting location…');
  const [awaitingPreciseFix, setAwaitingPreciseFix] = useState(true);

  useEffect(() => {
    if (!locationGranted) return;
    setAwaitingPreciseFix(true);
    // Wait for a street-level-accurate fix rather than centring the map on
    // whatever the first (possibly network-triangulated) reading is.
    getAccurateFix()
      .then(async (pos) => {
        setAwaitingPreciseFix(false);
        if (!pos) return;
        const { latitude, longitude } = pos.coords;
        setMapRegion({ latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 });
        const [addr] = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => [null]);
        setLocationName(addr ? streetLevelLabel(addr) : 'Current location');
      })
      .catch(() => setAwaitingPreciseFix(false));
  }, [locationGranted]);

  // Fake call — countdown ticks down every second, then hands off to the
  // incoming-call screen. Cleared on unmount so a dashboard leave/rerender
  // can't leave a dangling interval.
  useEffect(() => {
    return () => {
      if (fakeCallIntervalRef.current) clearInterval(fakeCallIntervalRef.current);
    };
  }, []);

  const handleScheduleFakeCall = (callerName: string, seconds: number) => {
    setShowFakeCallSheet(false);
    fakeCallNameRef.current = callerName;
    setFakeCallCountdown(seconds);
    // Run permission checks/prompts now, as soon as the call is scheduled,
    // so the user has the full countdown window to grant them rather than
    // hitting a silent failure right as the call is meant to ring.
    void ensureFakeCallPermissions();
    if (fakeCallIntervalRef.current) clearInterval(fakeCallIntervalRef.current);
    fakeCallIntervalRef.current = setInterval(() => {
      setFakeCallCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (fakeCallIntervalRef.current) clearInterval(fakeCallIntervalRef.current);
          fakeCallIntervalRef.current = null;
          const callerName = fakeCallNameRef.current;
          // Prefer the real native incoming-call screen (system ringtone,
          // respects silent mode) — only fall back to the in-app screens if
          // CallKeep setup/permission fails.
          void displayIncomingFakeCall(callerName).then((uuid) => {
            if (!uuid) navigation.replace('IncomingCall', { callerName });
          });
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleCancelFakeCall = () => {
    if (fakeCallIntervalRef.current) clearInterval(fakeCallIntervalRef.current);
    fakeCallIntervalRef.current = null;
    setFakeCallCountdown(null);
  };

  return (
    <View style={styles.idleRoot}>
      <View style={[styles.dashboardTop, { paddingTop: insets.top + 8 }]}>
        <HadinLogo size={32} />
      </View>

      {fakeCallCountdown !== null && (
        <Pressable
          style={[styles.fakeCallBanner, { top: insets.top + 52 }]}
          onPress={handleCancelFakeCall}
        >
          <Feather name="phone-incoming" size={14} color={colors.white} />
          <Text style={styles.fakeCallBannerText}>
            Incoming call in {fakeCallCountdown}s — Tap to cancel
          </Text>
        </Pressable>
      )}

      <ScrollView
        style={styles.idleScroll}
        contentContainerStyle={[styles.idleScrollContent, { paddingBottom: insets.bottom + 78 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Mode toggle */}
        <Pressable
          style={[styles.modeRow, sosActive && styles.lockedControl]}
          disabled={sosActive}
          onLayout={(event) => setModeToggleWidth(event.nativeEvent.layout.width)}
          onPress={(event) => {
            const tapX = event.nativeEvent.locationX;
            void handleModeToggle(tapX < modeToggleWidth / 2 ? 'always_on' : 'trip');
          }}
          {...modePanResponder.panHandlers}
        >
          {modeThumbWidth > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.modeThumb,
                {
                  width: modeThumbWidth,
                  transform: [{
                    translateX: modeSlide.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, modeThumbWidth],
                    }),
                  }],
                },
              ]}
            />
          ) : null}
          <View
            pointerEvents="none"
            style={styles.modeSegment}
          >
            <Feather
              name={userPlan === 'basic' ? 'lock' : 'check-circle'}
              size={15}
              color={userPlan === 'basic' ? '#9CA3AF' : userMode === 'always_on' ? colors.white : '#111827'}
            />
            <Text style={[
              styles.modeText,
              userPlan === 'basic' ? styles.modeGatedText : userMode === 'always_on' ? styles.modeTextActive : styles.modeTextInactive,
            ]}>
              Always On
            </Text>
            {userPlan === 'basic' && (
              <View style={styles.upgradeBadge}>
                <Text style={styles.upgradeBadgeText}>ELITE</Text>
              </View>
            )}
          </View>
          <View
            pointerEvents="none"
            style={styles.modeSegment}
          >
            <MaterialCommunityIcons name="run" size={15} color={userMode === 'trip' ? colors.white : '#111827'} />
            <Text style={[styles.modeText, userMode === 'trip' ? styles.modeTextActive : styles.modeTextInactive]}>
              Trip Mode
            </Text>
          </View>
        </Pressable>

        {userMode === 'always_on' && !alwaysOnRunning && (
          <Pressable style={styles.gpsBanner} onPress={() => void startAlwaysOnline()}>
            <Feather name="alert-circle" size={14} color="#92400E" />
            <Text style={styles.gpsBannerText}>Tracking paused — tap to resume</Text>
          </Pressable>
        )}

        {sosActive && (
          <View style={atStyles.sosStatusCard}>
            <View style={atStyles.sosStatusTop}>
              <View style={atStyles.sosPulse} />
              <Text style={atStyles.sosStatusTitle}>SOS alert sent</Text>
              {sosTime ? <Text style={atStyles.sosStatusTime}>{sosTime}</Text> : null}
            </View>
            <Text style={atStyles.sosStatusText}>
              Contacts reached: {sosNotified} of {sosTotal}
            </Text>
            <Pressable style={({ pressed }) => [styles.sosCancelBtn, pressed && { opacity: 0.85 }]} onPress={onCancelSOS}>
              <Text style={styles.sosCancelBtnText}>Cancel SOS</Text>
            </Pressable>
          </View>
        )}

        {/* Map */}
        <View style={styles.mapFullBleed}>
          <View style={styles.mapCard}>
            <MapView
              style={StyleSheet.absoluteFill}
              region={mapRegion}
              scrollEnabled
              zoomEnabled
              zoomTapEnabled
              pitchEnabled={false}
              rotateEnabled={false}
            >
              <Marker coordinate={{ latitude: mapRegion.latitude, longitude: mapRegion.longitude }} />
            </MapView>

            {awaitingPreciseFix && (
              <View style={styles.preciseFixBanner}>
                <ActivityIndicator size="small" color={colors.white} />
                <Text style={styles.preciseFixBannerText}>Getting your precise location…</Text>
              </View>
            )}

            {/* Location badge */}
            <View style={styles.locationBadge}>
              <View style={styles.locationBadgeIcon}>
                <Feather name="map-pin" size={15} color="#1F8A63" />
              </View>
              <View>
                <Text style={styles.locationEyebrow}>CURRENT LOCATION</Text>
                <Text style={styles.locationText} numberOfLines={1}>{locationName}</Text>
              </View>
            </View>

            {/* Map controls */}
            <View style={styles.mapControls}>
              <Animated.View style={{ transform: [{ scale: addTripScale }] }}>
                <Pressable
                  style={[styles.mapControlBtn, sosActive && styles.lockedControl]}
                  disabled={sosActive}
                  onPress={onStartTrip}
                  onPressIn={() => animateAddTrip(0.94)}
                  onPressOut={() => animateAddTrip(1)}
                >
                  <Feather name="plus-circle" size={21} color="#4B0082" />
                </Pressable>
              </Animated.View>
              <Pressable
                style={styles.mapControlBtn}
                onPress={() => {
                  setMapRegion(NIGERIA_DEFAULT);
                }}
              >
                <Feather name="crosshair" size={20} color="#4B0082" />
              </Pressable>
              <Pressable
                style={[styles.mapControlBtn, sosActive && styles.lockedControl]}
                disabled={sosActive}
                onPress={() => setShowFakeCallSheet(true)}
              >
                <Feather name="phone" size={20} color="#4B0082" />
              </Pressable>
              <Pressable
                style={styles.sosFab}
                disabled={sosActive}
                onPress={onSOSPress}
              >
                <Text style={styles.sosStar}>✱</Text>
                <Text style={styles.sosText}>SOS</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* My Safety Circle */}
        <View style={styles.safetyCircleSection}>
          <DashboardSection title="My Safety Circle" action="View All" onAction={onNavigateToCircle} disabled={sosActive}>
            {visibleContacts.map((c) => (
              <View key={c.id} style={styles.dashboardContactRow}>
                <View style={styles.dashboardAvatar}>
                  <Text style={styles.dashboardAvatarText}>{initials(c.name)}</Text>
                </View>
                <View style={styles.dashboardRowMid}>
                  <Text style={styles.dashboardContactName}>{c.name}</Text>
                  <Text style={styles.dashboardContactMeta}>{c.relationship ?? 'Trusted Contact'}</Text>
                </View>
                <Feather name="check-circle" size={18} color="#10B981" />
              </View>
            ))}
            <Pressable style={styles.addCircleCard} onPress={onAddCircleMember}>
              <View style={styles.addCircleIcon}>
                <Feather name="user-plus" size={17} color="#111827" />
              </View>
              <View style={styles.dashboardRowMid}>
                <Text style={styles.addCircleTitle}>Add a Circle Member</Text>
                <Text style={styles.addCircleMeta}>Invite someone to watch over you</Text>
              </View>
            </Pressable>
          </DashboardSection>
        </View>

        {/* History */}
        <DashboardSection title="History" action="View All" onAction={onNavigateToRoutes} disabled={sosActive}>
          {historyItems.length === 0 ? (
            <View style={styles.emptyHistoryCard}>
              <Feather name="clock" size={20} color="#D1D5DB" />
              <Text style={styles.emptyHistoryText}>No trips yet</Text>
            </View>
          ) : (
            historyItems.map((trip, index) => (
              <View key={trip.id ?? index} style={styles.historyRow}>
                <View style={styles.historyIcon}>
                  <Feather name={index === 0 ? 'home' : 'git-pull-request'} size={17} color="#6B7280" />
                </View>
                <Text style={styles.historyTitle} numberOfLines={1}>
                  {trip.origin && trip.origin !== '—' ? trip.origin : 'Trip'}
                </Text>
                <Text style={styles.historyTime}>
                  {trip.created_at ? formatDate(trip.created_at) : ''}
                </Text>
              </View>
            ))
          )}
        </DashboardSection>

        {/* Family Groups */}
        <DashboardSection title="Family Groups" action="View All" onAction={onNavigateToCircle} disabled={sosActive}>
          {userPlan === 'basic' ? (
            <View style={styles.upgradeCard}>
              <View style={styles.upgradeLockIcon}>
                <Feather name="lock" size={20} color="#6B21A8" />
              </View>
              <View style={styles.dashboardRowMid}>
                <Text style={styles.upgradeCardTitle}>Unlock with Elite Plan</Text>
                <Text style={styles.upgradeCardMeta}>Manage family groups, share live location with family</Text>
              </View>
              <Feather name="chevron-right" size={16} color="#6B21A8" />
            </View>
          ) : familyGroups.length === 0 ? (
            <Pressable style={styles.addCircleCard} onPress={onNavigateToCircle}>
              <View style={[styles.addCircleIcon, styles.familyAddIcon]}>
                <Feather name="users" size={17} color={colors.white} />
              </View>
              <View>
                <Text style={styles.addCircleTitle}>Add a Family Group</Text>
                <Text style={styles.addCircleMeta}>Create a group to share your location</Text>
              </View>
            </Pressable>
          ) : (
            familyGroups.map((group) => (
              <View key={group.id} style={styles.familyCard}>
                <View style={styles.familyIcon}>
                  <Feather name="users" size={18} color={colors.white} />
                </View>
                <View style={styles.dashboardRowMid}>
                  <Text style={styles.dashboardContactName}>{group.name}</Text>
                  <Text style={styles.dashboardContactMeta}>{group.member_count} members</Text>
                </View>
                <View style={styles.activeStatus}>
                  <View style={styles.activeDot} />
                  <Text style={styles.activeStatusText}>Active</Text>
                </View>
              </View>
            ))
          )}
        </DashboardSection>
      </ScrollView>

      {/* Tab bar */}
      <View style={[styles.tabBar, { paddingBottom: insets.bottom || spacing.gap8 }]}>
        <TabBarItem icon="grid" label="Dashboard" active />
        <TabBarItem icon="users" label="Circle" onPress={onNavigateToCircle} disabled={sosActive} />
        <TabBarItem icon="clock" label="History" onPress={onNavigateToRoutes} disabled={sosActive} />
        <TabBarItem icon="user" label="Profile" onPress={onNavigateToSettings} disabled={sosActive} />
      </View>

      <UpgradeSheet
        visible={showUpgradeSheet}
        onClose={() => setShowUpgradeSheet(false)}
        onUpgrade={() => { setShowUpgradeSheet(false); onUpgrade(); }}
      />

      <FakeCallSetupSheet
        visible={showFakeCallSheet}
        onClose={() => setShowFakeCallSheet(false)}
        onSchedule={handleScheduleFakeCall}
      />
    </View>
  );
};

// ── Upgrade sheet (Always Online on Basic plan) ─────────────────────────────────

interface UpgradeSheetProps {
  visible: boolean;
  onClose: () => void;
  onUpgrade: () => void;
}

const UpgradeSheet = ({ visible, onClose, onUpgrade }: UpgradeSheetProps) => (
  <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
    <View style={usStyles.overlay}>
      <Pressable style={usStyles.dismiss} onPress={onClose} />
      <View style={usStyles.sheet}>
        <View style={usStyles.handleRow}><View style={usStyles.handle} /></View>
        <View style={usStyles.iconWrap}>
          <Feather name="lock" size={22} color="#6B21A8" />
        </View>
        <Text style={usStyles.title}>Always Online is an Elite feature</Text>
        <Text style={usStyles.body}>
          Upgrade to unlock continuous tracking, Follow me, and Family mode.
        </Text>
        <Pressable style={({ pressed }) => [usStyles.upgradeBtn, pressed && { opacity: 0.85 }]} onPress={onUpgrade}>
          <Text style={usStyles.upgradeBtnText}>Upgrade now</Text>
        </Pressable>
        <Pressable style={usStyles.cancelLink} onPress={onClose}>
          <Text style={usStyles.cancelLinkText}>Not now</Text>
        </Pressable>
      </View>
    </View>
  </Modal>
);

const usStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 24, paddingBottom: 28, alignItems: 'center' },
  handleRow: { alignSelf: 'stretch', alignItems: 'center', marginTop: 10, marginBottom: 6 },
  handle: { width: 32, height: 3, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.1)' },
  iconWrap: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#F3E8FF', alignItems: 'center', justifyContent: 'center', marginTop: 14, marginBottom: 14 },
  title: { fontSize: 17, fontWeight: '800', color: colors.brand.textPrimary, textAlign: 'center', marginBottom: 8 },
  body: { fontSize: 13, color: colors.brand.textSecondary, textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  upgradeBtn: { alignSelf: 'stretch', backgroundColor: '#6B21A8', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 6 },
  upgradeBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },
  cancelLink: { paddingVertical: 12 },
  cancelLinkText: { fontSize: 13, color: colors.brand.textSecondary, fontWeight: '600' },
});

// ── Section wrapper ───────────────────────────────────────────────────────────

interface DashboardSectionProps {
  title: string;
  action: string;
  onAction: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

const DashboardSection = ({ title, action, onAction, disabled, children }: DashboardSectionProps) => (
  <View style={styles.dashboardSection}>
    <View style={styles.dashboardSectionHeader}>
      <Text style={styles.dashboardSectionTitle}>{title}</Text>
      <Pressable style={styles.dashboardSectionAction} onPress={onAction} disabled={disabled}>
        <Text style={[styles.dashboardSectionActionText, disabled && styles.lockedText]}>{action}</Text>
        <Feather name="chevron-right" size={14} color={disabled ? '#9CA3AF' : '#6B21A8'} />
      </Pressable>
    </View>
    <View style={[styles.dashboardSectionBody, disabled && styles.lockedControl]} pointerEvents={disabled ? 'none' : 'auto'}>{children}</View>
  </View>
);

// ── Active trip view ──────────────────────────────────────────────────────────

interface ActiveTripViewProps {
  trip: Trip;
  tripContacts: CircleContact[];
  lastPing: LocationPing | null;
  sosLoading: boolean;
  sosActive: boolean;
  sosTime?: string;
  sosNotified: number;
  sosTotal: number;
  onSOSTap: () => void;
  onCancelSOS: () => void;
  onEndTrip: () => void;
  onNavigateToCircle: () => void;
  onNavigateToRoutes: () => void;
  onNavigateToSettings: () => void;
}

const ActiveTripView = ({
  trip, tripContacts, lastPing, sosLoading, sosActive, sosTime, sosNotified, sosTotal,
  onSOSTap, onCancelSOS, onEndTrip, onNavigateToCircle, onNavigateToRoutes, onNavigateToSettings,
}: ActiveTripViewProps) => {
  const insets = useSafeAreaInsets();

  const [elapsed, setElapsed] = useState('0m');
  useEffect(() => {
    function compute() {
      // Clamp to 0 — a trip that just started can briefly read a negative
      // delta if the device clock is a few hundred ms behind the server
      // timestamp on `trip.created_at`, which previously rendered "-1m".
      const ms = Math.max(0, Date.now() - new Date(trip.created_at).getTime());
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`);
    }
    compute();
    const id = setInterval(compute, 30_000);
    return () => clearInterval(id);
  }, [trip.created_at]);

  const started = trip.started_at ?? trip.created_at;
  const destination = trip.destination?.trim() || 'Destination';
  const estimatedTime = trip.expected_duration_minutes
    ? `${trip.expected_duration_minutes} mins`
    : trip.max_stop_duration_minutes
      ? `${trip.max_stop_duration_minutes} mins`
      : '25 mins';
  const updated = lastPing ? formatTime(lastPing.timestamp) : formatTime(started);
  const coords = lastPing
    ? `${Math.abs(lastPing.lat).toFixed(4)}° ${lastPing.lat >= 0 ? 'N' : 'S'}, ${Math.abs(lastPing.lng).toFixed(4)}° ${lastPing.lng >= 0 ? 'E' : 'W'}`
    : 'Waiting for first ping';

  // Live "Current Location" label — reverse-geocoded from the latest ping,
  // re-resolved whenever the ping's coordinates actually move.
  const [currentLocationName, setCurrentLocationName] = useState(trip.origin?.trim() || 'Locating…');
  const [activeMapInfo, setActiveMapInfo] = useState<'current' | 'destination' | null>(null);
  const mapInfoSlide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!lastPing) return;
    Location.reverseGeocodeAsync({ latitude: lastPing.lat, longitude: lastPing.lng })
      .then(([addr]) => {
        if (!addr) return;
        setCurrentLocationName(streetLevelLabel(addr));
      })
      .catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPing?.lat, lastPing?.lng]);

  const mapRegion = lastPing
    ? { latitude: lastPing.lat, longitude: lastPing.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }
    : trip.destination_lat != null && trip.destination_lng != null
      ? { latitude: trip.destination_lat, longitude: trip.destination_lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }
      : NIGERIA_DEFAULT;

  const toggleMapInfo = (target: 'current' | 'destination') => {
    if (activeMapInfo === target) {
      Animated.timing(mapInfoSlide, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }).start(() => setActiveMapInfo(null));
      return;
    }

    mapInfoSlide.setValue(0);
    setActiveMapInfo(target);
    Animated.spring(mapInfoSlide, {
      toValue: 1,
      useNativeDriver: true,
      speed: 24,
      bounciness: 5,
    }).start();
  };

  return (
    <View style={[atStyles.root, { paddingTop: insets.top }]}>
      <View style={atStyles.header}>
        <View style={atStyles.headerLeft}>
          <Pressable style={atStyles.backBtn} onPress={onNavigateToRoutes} hitSlop={8} disabled={sosActive}>
            <Feather name="arrow-left" size={22} color={sosActive ? '#D1D5DB' : '#111827'} />
          </Pressable>
          <Text style={atStyles.headerTitle}>Active Trip</Text>
        </View>
      </View>

      <ScrollView
        style={atStyles.scroll}
        contentContainerStyle={[atStyles.scrollContent, { paddingBottom: insets.bottom + 98 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={atStyles.mapPanel}>
          <MapView style={atStyles.mapImage} region={mapRegion}>
            {lastPing && (
              <Marker
                coordinate={{ latitude: lastPing.lat, longitude: lastPing.lng }}
                title="Current location"
                pinColor="#0051D5"
              />
            )}
            {trip.destination_lat != null && trip.destination_lng != null && (
              <Marker
                coordinate={{ latitude: trip.destination_lat, longitude: trip.destination_lng }}
                title="Destination"
                pinColor="#BA1A1A"
              />
            )}
          </MapView>

          {!lastPing && (
            <View style={atStyles.preciseFixBanner}>
              <ActivityIndicator size="small" color={colors.white} />
              <Text style={atStyles.preciseFixBannerText}>Getting your precise location…</Text>
            </View>
          )}

          {activeMapInfo ? (
            <Animated.View
              style={[
                atStyles.mapInfoPanel,
                {
                  opacity: mapInfoSlide,
                  transform: [
                    { translateY: -31 },
                    {
                      translateX: mapInfoSlide.interpolate({
                        inputRange: [0, 1],
                        outputRange: [18, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Feather
                name={activeMapInfo === 'current' ? 'navigation' : 'map-pin'}
                size={22}
                color={activeMapInfo === 'current' ? '#0051D5' : '#BA1A1A'}
              />
              <View style={atStyles.mapInfoText}>
                <Text style={atStyles.mapInfoLabel}>
                  {activeMapInfo === 'current' ? 'Current Location' : 'Destination'}
                </Text>
                <Text style={atStyles.mapInfoValue} numberOfLines={2}>
                  {activeMapInfo === 'current' ? currentLocationName : destination}
                </Text>
              </View>
            </Animated.View>
          ) : null}

          <View style={atStyles.mapInfoControls}>
            <Pressable
              style={[atStyles.mapInfoIconBtn, activeMapInfo === 'current' && atStyles.mapInfoIconBtnActive]}
              onPress={() => toggleMapInfo('current')}
            >
              <Feather name="navigation" size={20} color={activeMapInfo === 'current' ? '#FFFFFF' : '#0051D5'} />
            </Pressable>
            <Pressable
              style={[atStyles.mapInfoIconBtn, activeMapInfo === 'destination' && atStyles.mapInfoIconBtnActive]}
              onPress={() => toggleMapInfo('destination')}
            >
              <Feather name="map-pin" size={20} color={activeMapInfo === 'destination' ? '#FFFFFF' : '#BA1A1A'} />
            </Pressable>
          </View>
        </View>

        <View style={atStyles.statGrid}>
          <View style={atStyles.statCard}>
            <Feather name="clock" size={24} color="#7C839B" />
            <Text style={atStyles.statLabel}>Estimated Time</Text>
            <Text style={atStyles.statValue}>{estimatedTime}</Text>
          </View>
          <View style={atStyles.statCard}>
            <Feather name="activity" size={24} color="#0051D5" />
            <Text style={atStyles.statLabel}>Time Elapsed</Text>
            <Text style={atStyles.statValue}>{elapsed || '0m'}</Text>
          </View>
        </View>

        <View style={atStyles.actionStack}>
          <Pressable
            style={({ pressed }) => [atStyles.arrivedBtn, pressed && !sosActive && { opacity: 0.88 }, sosActive && styles.lockedControl]}
            onPress={onEndTrip}
            disabled={sosActive}
          >
            <Feather name="check-circle" size={24} color="#FFFFFF" />
            <Text style={atStyles.actionText}>Arrived</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [atStyles.sosBtn, pressed && !sosLoading && { opacity: 0.85 }, sosLoading && { opacity: 0.6 }]}
            onPress={sosActive ? onCancelSOS : onSOSTap}
            disabled={sosLoading}
          >
            {sosLoading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Feather name={sosActive ? 'x-circle' : 'home'} size={24} color="#FFFFFF" />
            )}
            <Text style={atStyles.actionText}>{sosActive ? 'Cancel SOS' : 'SOS'}</Text>
          </Pressable>
        </View>

        {sosActive && (
          <View style={atStyles.sosStatusCard}>
            <View style={atStyles.sosStatusTop}>
              <View style={atStyles.sosPulse} />
              <Text style={atStyles.sosStatusTitle}>SOS alert sent</Text>
              {sosTime ? <Text style={atStyles.sosStatusTime}>{sosTime}</Text> : null}
            </View>
            <Text style={atStyles.sosStatusText}>
              Contacts reached: {sosNotified} of {sosTotal || tripContacts.length}
            </Text>
          </View>
        )}

        <View style={atStyles.detailCard}>
          <View style={atStyles.detailRow}>
            <View style={atStyles.detailLeft}>
              <Feather name="compass" size={15} color="#45464D" />
              <Text style={atStyles.detailLabel}>Last Known Location</Text>
            </View>
            <Text style={atStyles.detailValue} numberOfLines={1}>{coords}</Text>
          </View>
          <View style={[atStyles.detailRow, atStyles.detailRowLast]}>
            <View style={atStyles.detailLeft}>
              <Feather name="refresh-cw" size={15} color="#45464D" />
              <Text style={atStyles.detailLabel}>Last Updated</Text>
            </View>
            <View style={atStyles.liveWrap}>
              <View style={atStyles.liveDot} />
              <Text style={atStyles.liveText}>{lastPing ? updated : 'Pending'}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.atTabBar, { paddingBottom: insets.bottom || spacing.gap8 }]}>
        <TabBarItem icon="grid" label="Dashboard" active />
        <TabBarItem icon="users" label="Circle" onPress={onNavigateToCircle} disabled={sosActive} />
        <TabBarItem icon="clock" label="History" onPress={onNavigateToRoutes} disabled={sosActive} />
        <TabBarItem icon="user" label="Profile" onPress={onNavigateToSettings} disabled={sosActive} />
      </View>
    </View>
  );
};

// ── SOS countdown overlay ────────────────────────────────────────────────────

interface SOSCountdownOverlayProps {
  visible: boolean;
  currentLocation?: string;
  onCancel: () => void;
  onConfirm: () => Promise<boolean>;
  onDone: () => void;
}

const SOSCountdownOverlay = ({ visible, currentLocation, onCancel, onConfirm, onDone }: SOSCountdownOverlayProps) => {
  const insets = useSafeAreaInsets();
  const [seconds, setSeconds] = useState(SOS_COUNTDOWN_SECONDS);
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState(false);
  const hasTriggeredRef = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;

  const fireSOS = useCallback(async () => {
    if (hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;
    setConfirming(true);
    const ok = await onConfirm();
    setConfirming(false);
    if (ok) {
      setSent(true);
    } else {
      hasTriggeredRef.current = false;
    }
  }, [onConfirm]);

  useEffect(() => {
    if (!visible) return;
    setSeconds(SOS_COUNTDOWN_SECONDS);
    setConfirming(false);
    setSent(false);
    hasTriggeredRef.current = false;
  }, [visible]);

  useEffect(() => {
    if (!visible || sent) return;
    if (seconds <= 0) {
      void fireSOS();
      return;
    }
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [fireSOS, seconds, sent, visible]);

  useEffect(() => {
    if (!visible || sent) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, sent, visible]);

  const handleCancel = () => {
    if (confirming) return;
    onCancel();
  };

  const handleDone = () => {
    onDone();
  };

  const progress = Math.max(0, seconds / SOS_COUNTDOWN_SECONDS);
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.32] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.38, 0] });

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={handleCancel}>
      {sent ? (
        <View style={[sosCountdownStyles.successRoot, { paddingTop: insets.top, paddingBottom: insets.bottom + 28 }]}>
          <View style={sosCountdownStyles.successIcon}>
            <Feather name="check" size={38} color="#009668" />
          </View>
          <Text style={sosCountdownStyles.successTitle}>Help is on the way</Text>
          <Text style={sosCountdownStyles.successText}>
            Emergency responders and your safety circle have been notified with your live coordinates.
          </Text>
          <Pressable style={({ pressed }) => [sosCountdownStyles.returnBtn, pressed && { opacity: 0.88 }]} onPress={handleDone}>
            <Text style={sosCountdownStyles.returnBtnText}>Return to Dashboard</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[sosCountdownStyles.overlay, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}>
          <View style={sosCountdownStyles.alertTop}>
            <Feather name="alert-triangle" size={48} color="#BA1A1A" />
            <Text style={sosCountdownStyles.alertTitle}>Emergency SOS</Text>
            <Text style={sosCountdownStyles.alertSub}>Alerting your emergency contacts in...</Text>
          </View>

          <View style={sosCountdownStyles.countWrap}>
            <Animated.View
              pointerEvents="none"
              style={[
                sosCountdownStyles.pulseRing,
                { opacity: pulseOpacity, transform: [{ scale: pulseScale }] },
              ]}
            />
            <View style={sosCountdownStyles.outerRing}>
              <View style={[sosCountdownStyles.progressRing, { opacity: 0.3 + progress * 0.7 }]} />
              <View style={sosCountdownStyles.innerRing}>
                <Text style={sosCountdownStyles.countNumber}>{seconds}</Text>
                <Text style={sosCountdownStyles.countLabel}>Seconds</Text>
              </View>
            </View>
          </View>

          <View style={sosCountdownStyles.locationCard}>
            <View style={sosCountdownStyles.locationIcon}>
              <Feather name="map-pin" size={22} color="#BA1A1A" />
            </View>
            <View style={sosCountdownStyles.locationCopy}>
              <Text style={sosCountdownStyles.locationLabel}>Current Location</Text>
              <Text style={sosCountdownStyles.locationValue} numberOfLines={2}>
                {currentLocation || 'Getting your live coordinates'}
              </Text>
            </View>
          </View>

          <View style={sosCountdownStyles.actionCluster}>
            <Pressable
              style={({ pressed }) => [sosCountdownStyles.confirmBtn, pressed && !confirming && { opacity: 0.88 }, confirming && { opacity: 0.7 }]}
              onPress={fireSOS}
              disabled={confirming}
            >
              {confirming ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={sosCountdownStyles.confirmText}>Confirm Alert</Text>}
              {!confirming && <Feather name="send" size={22} color="#FFFFFF" />}
            </Pressable>
            <Pressable
              style={({ pressed }) => [sosCountdownStyles.cancelBtn, pressed && !confirming && { backgroundColor: 'rgba(255,255,255,0.08)' }]}
              onPress={handleCancel}
              disabled={confirming}
            >
              <Text style={sosCountdownStyles.cancelText}>Cancel</Text>
            </Pressable>
          </View>

          <Text style={sosCountdownStyles.footerNote}>
            Falsely triggering alerts may result in service limitations. Hadin encryption is currently active.
          </Text>
        </View>
      )}
    </Modal>
  );
};

// ── End trip modal ────────────────────────────────────────────────────────────

interface EndTripModalProps {
  visible: boolean;
  trip: Trip;
  contactCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const EndTripModal = ({ visible, trip, contactCount, onConfirm, onCancel }: EndTripModalProps) => {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    if (!visible) return;
    function compute() {
      const ms = Math.max(0, Date.now() - new Date(trip.created_at).getTime());
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`);
    }
    compute();
    const id = setInterval(compute, 60_000);
    return () => clearInterval(id);
  }, [visible, trip.created_at]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <Pressable style={etStyles.overlay} onPress={onCancel}>
        <Pressable style={etStyles.card} onPress={() => {}}>
          <View style={etStyles.header}>
            <View style={etStyles.routeRow}>
              <Feather name="navigation" size={18} color="rgba(255,255,255,0.82)" />
              <Text style={etStyles.routeTxt} numberOfLines={1}>
                Current location <Text style={etStyles.routeArrow}>→</Text> {trip.destination?.trim() || 'Destination'}
              </Text>
            </View>
            <Text style={etStyles.metaTxt}>
              {[elapsed, `${contactCount} contact${contactCount !== 1 ? 's' : ''}`].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={etStyles.divider} />
          <View style={etStyles.body}>
            <Text style={etStyles.headline}>End this trip?</Text>
            <Text style={etStyles.subtext}>
              {contactCount > 0
                ? 'Your circle will be notified you arrived safely.'
                : 'GPS tracking will stop and your trip will be marked complete.'}
            </Text>
          </View>
          <Pressable style={({ pressed }) => [etStyles.confirmBtn, pressed && { opacity: 0.85 }]} onPress={onConfirm}>
            <Feather name="check" size={18} color="#FFFFFF" />
            <Text style={etStyles.confirmTxt}>Yes, I'm safe</Text>
          </Pressable>
          <Pressable style={etStyles.cancelLink} onPress={onCancel}>
            <Text style={etStyles.cancelLinkTxt}>Keep travelling</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const etStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(8,24,18,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#071D12',
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  header: { paddingHorizontal: 28, paddingTop: 28, paddingBottom: 24, backgroundColor: '#10381F' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  routeTxt: { fontSize: 22, lineHeight: 30, fontWeight: '900', color: '#FFFFFF', flex: 1 },
  routeArrow: { fontWeight: '900', color: '#FFFFFF' },
  metaTxt: { fontSize: 16, lineHeight: 22, color: 'rgba(255,255,255,0.48)', fontWeight: '700' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.04)' },
  body: { paddingHorizontal: 28, paddingTop: 34, paddingBottom: 20 },
  headline: { fontSize: 26, lineHeight: 34, fontWeight: '900', color: '#FFFFFF', marginBottom: 14 },
  subtext: { fontSize: 18, color: 'rgba(255,255,255,0.52)', lineHeight: 26, fontWeight: '600' },
  confirmBtn: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#1F8058',
    marginHorizontal: 28,
    marginTop: 12,
    borderRadius: 14,
    paddingVertical: 18,
  },
  confirmTxt: { fontSize: 21, lineHeight: 28, fontWeight: '900', color: '#FFFFFF' },
  cancelLink: { alignItems: 'center', paddingTop: 24, paddingBottom: 28 },
  cancelLinkTxt: { fontSize: 16, color: 'rgba(255,255,255,0.38)', fontWeight: '800' },
});

const sosCountdownStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#191C1E',
  },
  alertTop: { alignItems: 'center', gap: 8, marginBottom: 24 },
  alertTitle: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '800',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  alertSub: { fontSize: 16, lineHeight: 24, fontWeight: '500', color: 'rgba(255,255,255,0.78)', textAlign: 'center' },
  countWrap: {
    width: 256,
    height: 256,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  pulseRing: {
    position: 'absolute',
    width: 224,
    height: 224,
    borderRadius: 112,
    borderWidth: 2,
    borderColor: '#BA1A1A',
  },
  outerRing: {
    width: 256,
    height: 256,
    borderRadius: 128,
    borderWidth: 12,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRing: {
    position: 'absolute',
    width: 256,
    height: 256,
    borderRadius: 128,
    borderWidth: 12,
    borderColor: '#BA1A1A',
  },
  innerRing: {
    width: 192,
    height: 192,
    borderRadius: 96,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  countNumber: { fontSize: 96, lineHeight: 104, fontWeight: '900', color: '#BA1A1A' },
  countLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.62)',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  locationCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(0,0,0,0.22)',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 32,
  },
  locationIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(186,26,26,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationCopy: { flex: 1 },
  locationLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.62)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  locationValue: { marginTop: 3, fontSize: 14, lineHeight: 20, fontWeight: '700', color: '#FFFFFF' },
  actionCluster: { width: '100%', maxWidth: 520, gap: 16 },
  confirmBtn: {
    height: 64,
    borderRadius: 12,
    backgroundColor: '#BA1A1A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#BA1A1A',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  confirmText: { fontSize: 24, lineHeight: 32, fontWeight: '800', color: '#FFFFFF' },
  cancelBtn: {
    height: 64,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontSize: 18, lineHeight: 24, fontWeight: '800', color: '#FFFFFF' },
  footerNote: {
    maxWidth: 520,
    marginTop: 32,
    paddingHorizontal: 24,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.42)',
    textAlign: 'center',
  },
  successRoot: {
    flex: 1,
    backgroundColor: '#F7F9FB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#4EDEA3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successTitle: { fontSize: 32, lineHeight: 40, fontWeight: '800', color: '#191C1E', textAlign: 'center', marginBottom: 8 },
  successText: {
    maxWidth: 340,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '500',
    color: '#45464D',
    textAlign: 'center',
    marginBottom: 32,
  },
  returnBtn: {
    minWidth: 240,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  returnBtnText: { fontSize: 14, lineHeight: 20, fontWeight: '800', color: '#FFFFFF' },
});

// ── Tab bar item ──────────────────────────────────────────────────────────────

interface TabBarItemProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  active?: boolean;
  dark?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

const TabBarItem = ({ icon, label, active = false, dark = false, disabled = false, onPress }: TabBarItemProps) => (
  <Pressable style={[styles.tabItem, disabled && styles.lockedControl]} onPress={onPress} disabled={disabled}>
    <Feather name={icon} size={22} color={disabled ? '#D1D5DB' : active ? (dark ? colors.brand.mid : '#6B21A8') : (dark ? 'rgba(255,255,255,0.35)' : colors.brand.textSecondary)} />
    {active && <View style={[styles.tabActiveLine, dark && styles.tabActiveLineDark]} />}
    <Text style={[styles.tabLabel, active && (dark ? styles.tabLabelActiveDark : styles.tabLabelActive), !active && dark && styles.tabLabelInactiveDark, disabled && styles.lockedText]}>
      {label}
    </Text>
  </Pressable>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.brand.bgWarm },

  // Applied to any control that must be inert while an SOS is active — only
  // "Cancel SOS" stays interactive during an active alert.
  lockedControl: { opacity: 0.4 },
  lockedText: { color: '#9CA3AF' },

  idleRoot: { flex: 1, backgroundColor: '#F6F7FA' },
  dashboardTop: { alignItems: 'center', paddingBottom: 20, backgroundColor: '#F6F7FA' },
  idleScroll: { flex: 1 },
  idleScrollContent: { paddingHorizontal: 8, paddingTop: 0 },

  // GPS off banner
  gpsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  gpsBannerText: { flex: 1, fontSize: 12, color: '#92400E', fontWeight: '600' },
  sosCancelBtn: { alignSelf: 'stretch', backgroundColor: colors.white, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' },
  sosCancelBtnText: { fontSize: 13, fontWeight: '700', color: colors.brand.sos },

  // Mode toggle
  modeRow: {
    flexDirection: 'row',
    marginHorizontal: 14,
    marginBottom: 18,
    height: 44,
    borderRadius: 6,
    padding: 3,
    backgroundColor: '#E4E2E8',
    borderWidth: 1,
    borderColor: '#CFCAD6',
    overflow: 'hidden',
    position: 'relative',
  },
  modeThumb: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    borderRadius: 5,
    backgroundColor: '#3B008F',
    shadowColor: '#111827',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  modeSegment: {
    flex: 1,
    borderRadius: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    zIndex: 1,
  },
  alwaysOnPill: {},
  modeActive: { borderWidth: 2, borderColor: '#14B8A6' },
  modeGated: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
  modeGatedText: { color: '#9CA3AF' },
  modeText: { fontSize: 11, fontWeight: '800' },
  modeTextActive: { color: colors.white },
  modeTextInactive: { color: '#111827' },
  alwaysOnText: { color: colors.white, fontSize: 11, fontWeight: '800' },
  upgradeBadge: { backgroundColor: '#6B21A8', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, marginLeft: 4 },
  upgradeBadgeText: { fontSize: 8, fontWeight: '800', color: colors.white, letterSpacing: 0.3 },
  tripModePill: {},
  modeTripActive: { borderWidth: 2, borderColor: '#111827' },
  tripModeText: { color: '#111827', fontSize: 11, fontWeight: '700' },
  heroCtaPressed: { opacity: 0.85 },

  // Map
  mapCard: { height: 358, overflow: 'hidden', backgroundColor: '#E5E7EB', marginBottom: 22 },
  mapFullBleed: { marginHorizontal: -8 },
  locationBadge: {
    position: 'absolute', top: 14, left: 20, minWidth: 182,
    backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 3,
    paddingHorizontal: 12, paddingVertical: 9,
    flexDirection: 'row', alignItems: 'center', gap: 9,
    shadowColor: '#111827', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  locationBadgeIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#E8F7F1', alignItems: 'center', justifyContent: 'center' },
  locationEyebrow: { fontSize: 8, color: '#6B7280', fontWeight: '800' },
  locationText: { fontSize: 11, color: '#111827', fontWeight: '800', marginTop: 1, maxWidth: 142 },
  preciseFixBanner: {
    position: 'absolute', top: 12, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(17,24,39,0.85)', borderRadius: 20,
    paddingVertical: 6, paddingHorizontal: 14,
  },
  preciseFixBannerText: { fontSize: 11, fontWeight: '700', color: colors.white },
  mapControls: { position: 'absolute', right: 13, bottom: 15, alignItems: 'center', gap: 9 },
  mapControlBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#111827', shadowOpacity: 0.14, shadowRadius: 7, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  sosFab: {
    width: 55, height: 55, borderRadius: 28, backgroundColor: '#DC1F1F',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#111827', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  sosStar: { color: colors.white, fontSize: 28, fontWeight: '900', lineHeight: 28 },
  sosText: { color: colors.white, fontSize: 8, fontWeight: '800', marginTop: -1 },
  fakeCallBanner: {
    position: 'absolute', left: 20, right: 20, zIndex: 20,
    backgroundColor: '#4B0082', borderRadius: 24,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 16,
    shadowColor: '#111827', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  fakeCallBannerText: { color: colors.white, fontSize: 12, fontWeight: '700' },

  // Dashboard sections
  safetyCircleSection: { marginTop: 8 },
  dashboardSection: { marginBottom: 11 },
  dashboardSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  dashboardSectionTitle: { fontSize: 14, color: '#111827', fontWeight: '800' },
  dashboardSectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  dashboardSectionActionText: { fontSize: 12, color: '#6B21A8', fontWeight: '700' },
  dashboardSectionBody: { gap: 10 },

  // Circle
  dashboardContactRow: {
    minHeight: 58, borderRadius: 8, backgroundColor: colors.white, borderWidth: 1, borderColor: '#DDE1E7',
    paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  dashboardAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  dashboardAvatarText: { color: colors.white, fontSize: 11, fontWeight: '900' },
  dashboardRowMid: { flex: 1 },
  dashboardContactName: { color: '#111827', fontSize: 12, fontWeight: '900' },
  dashboardContactMeta: { color: '#6B7280', fontSize: 9, fontWeight: '600', marginTop: 2 },
  addCircleCard: {
    minHeight: 58, borderRadius: 8, backgroundColor: colors.white, borderWidth: 1, borderColor: '#DDE1E7',
    paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  addCircleIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  familyAddIcon: { backgroundColor: '#6B21A8' },
  addCircleTitle: { color: '#111827', fontSize: 12, fontWeight: '900' },
  addCircleMeta: { color: '#9CA3AF', fontSize: 8, fontWeight: '600', marginTop: 2 },
  emptySectionText: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', paddingVertical: 8 },

  // History
  historyRow: {
    minHeight: 43, borderRadius: 8, backgroundColor: colors.white, borderWidth: 1, borderColor: '#DDE1E7',
    paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  historyIcon: { width: 24, alignItems: 'center' },
  historyTitle: { flex: 1, color: '#374151', fontSize: 12, fontWeight: '600' },
  historyTime: { color: '#6B7280', fontSize: 9, fontWeight: '700' },
  emptyHistoryCard: {
    minHeight: 72, borderRadius: 8, backgroundColor: colors.white, borderWidth: 1, borderColor: '#DDE1E7',
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  emptyHistoryText: { fontSize: 13, color: '#D1D5DB', fontWeight: '600' },

  // Family groups
  familyCard: {
    minHeight: 58, borderRadius: 8, backgroundColor: colors.white, borderWidth: 1, borderColor: '#DDE1E7',
    paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  familyIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  activeStatus: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#10B981' },
  activeStatusText: { color: '#059669', fontSize: 9, fontWeight: '800' },
  upgradeCard: {
    minHeight: 72, borderRadius: 8, backgroundColor: '#FAF5FF', borderWidth: 1, borderColor: '#E9D5FF',
    paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  upgradeLockIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F3E8FF', alignItems: 'center', justifyContent: 'center' },
  upgradeCardTitle: { color: '#6B21A8', fontSize: 14, fontWeight: '900' },
  upgradeCardMeta: { color: '#A855F7', fontSize: 11, fontWeight: '500', marginTop: 3 },

  // Tab bar
  tabBar: { flexDirection: 'row', backgroundColor: '#E8EEFF', borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingBottom: spacing.gap8, paddingTop: 9 },
  atTabBar: { flexDirection: 'row', backgroundColor: '#E8EEFF', borderTopWidth: 1, borderTopColor: colors.brand.border, paddingTop: spacing.gap8 },
  tabItem: { flex: 1, alignItems: 'center', gap: 3 },
  tabActiveLine: { width: 0, height: 0 },
  tabActiveLineDark: { backgroundColor: colors.brand.mid },
  tabLabel: { fontSize: 9, color: '#111827', fontWeight: '600' },
  tabLabelActive: { color: '#6B21A8', fontWeight: '800' },
  tabLabelActiveDark: { color: colors.brand.mid, fontWeight: '600' },
  tabLabelInactiveDark: { color: 'rgba(255,255,255,0.35)' },
});

// ── Active trip styles ────────────────────────────────────────────────────────

const atStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F8FF' },
  header: {
    height: 64,
    backgroundColor: '#F8F8FF',
    borderBottomWidth: 1,
    borderBottomColor: '#C6C6CD',
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700', color: '#111827' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 0, gap: 24 },
  mapPanel: {
    height: 324,
    marginHorizontal: -16,
    borderRadius: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#C6C6CD',
    backgroundColor: '#ECEEF0',
    shadowColor: '#111827',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  mapImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  mapInfoControls: { position: 'absolute', right: 16, top: '50%', gap: 10, transform: [{ translateY: -47 }] },
  mapInfoIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#111827',
    shadowOpacity: 0.14,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  mapInfoIconBtnActive: {
    backgroundColor: '#4B0082',
    borderColor: '#4B0082',
  },
  mapInfoPanel: {
    position: 'absolute',
    top: '50%',
    right: 68,
    maxWidth: 238,
    minHeight: 62,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C6C6CD',
    backgroundColor: 'rgba(255,255,255,0.93)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#111827',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  mapInfoText: { flex: 1 },
  mapInfoLabel: {
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontWeight: '700',
    color: '#45464D',
  },
  mapInfoValue: { fontSize: 14, lineHeight: 20, color: '#191C1E', fontWeight: '700', marginTop: 2 },
  preciseFixBanner: {
    position: 'absolute', top: 12, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(17,24,39,0.85)', borderRadius: 20,
    paddingVertical: 6, paddingHorizontal: 14,
  },
  preciseFixBannerText: { fontSize: 11, fontWeight: '700', color: colors.white },
  statGrid: { flexDirection: 'row', gap: 16 },
  statCard: {
    flex: 1,
    minHeight: 126,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C6C6CD',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    shadowColor: '#111827',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  statLabel: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontWeight: '700',
    color: '#45464D',
    textAlign: 'center',
  },
  statValue: { marginTop: 4, fontSize: 20, lineHeight: 28, fontWeight: '800', color: '#111827', textAlign: 'center' },
  actionStack: { gap: 16 },
  arrivedBtn: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#4B0082',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#111827',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  sosBtn: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#BA1A1A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#BA1A1A',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  actionText: { fontSize: 18, lineHeight: 24, fontWeight: '800', color: '#FFFFFF' },
  sosStatusCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F7C1C1',
    backgroundColor: '#FFF1F1',
    padding: 14,
    gap: 8,
  },
  sosStatusTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sosPulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#BA1A1A' },
  sosStatusTitle: { flex: 1, fontSize: 13, fontWeight: '800', color: '#93000A' },
  sosStatusTime: { fontSize: 12, fontWeight: '700', color: '#93000A' },
  sosStatusText: { fontSize: 12, fontWeight: '600', color: '#93000A' },
  detailCard: { borderRadius: 12, backgroundColor: '#F2F4F6', paddingHorizontal: 16, paddingVertical: 4 },
  detailRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#C6C6CD',
    gap: 12,
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  detailLabel: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.5, color: '#45464D' },
  detailValue: { flex: 1, textAlign: 'right', fontSize: 13, lineHeight: 20, fontWeight: '700', color: '#191C1E' },
  liveWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4EDEA3' },
  liveText: { fontSize: 13, lineHeight: 20, fontWeight: '800', color: '#005236' },
});

// ── Setup modal styles ────────────────────────────────────────────────────────

const smStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 28,
    paddingTop: 28,
    alignItems: 'center',
  },
  iconCircle: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: colors.brand.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  iconCircleAudio: { backgroundColor: '#7C3AED' },
  iconCirclePin: { backgroundColor: '#1A6B4A' },
  title: { fontSize: 20, fontWeight: '800', color: colors.brand.textPrimary, marginBottom: 10, textAlign: 'center' },
  body: { fontSize: fontSizes.caption, color: colors.brand.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  primaryBtn: {
    width: '100%', backgroundColor: colors.brand.primary,
    borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginBottom: 10,
  },
  primaryBtnText: { fontSize: fontSizes.body, fontWeight: '700', color: colors.white },
  audioPrimaryBtn: { backgroundColor: '#4B0082' },
  cancelBtn: {
    width: '100%', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  cancelBtnText: { fontSize: fontSizes.body, fontWeight: '700', color: colors.brand.textPrimary },
  pinCancelBtn: { marginTop: 20, marginBottom: 0 },
  skipBtn: { width: '100%', paddingVertical: 12, alignItems: 'center', marginBottom: 4 },
  skipBtnText: { fontSize: fontSizes.caption, color: colors.brand.textSecondary, fontWeight: '600' },
  pressed: { opacity: 0.8 },

  // PIN
  pinDots: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  pinDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#D1D5DB', backgroundColor: 'transparent' },
  pinDotFilled: { backgroundColor: '#4B0082', borderColor: '#4B0082' },
  pinError: { fontSize: 12, color: colors.brand.sos, marginBottom: 8, textAlign: 'center' },
  numpad: { width: '100%', gap: 8, marginBottom: 12 },
  numpadRow: { flexDirection: 'row', gap: 8 },
  numpadKey: { flex: 1, height: 60, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  numpadKeyText: { fontSize: 22, fontWeight: '600', color: colors.brand.textPrimary },
  numpadPressed: { backgroundColor: '#E5E7EB' },
});

export default HomeScreen;

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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStackParamList } from '../../navigation/AppNavigator';
import { supabase } from '../../lib/supabase';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { stopTracking, getLastPing, LocationPing } from '../../services/LocationService';
import { triggerSOS, cancelSOS, SOSContact } from '../../services/SOSService';
import { getContacts } from '../../services/CircleService';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import StartTripModal, { Trip } from './StartTripModal';
import SuccessToast from '../../components/SuccessToast';
import HadinLogo from '../../components/HadinLogo';

// ── AsyncStorage keys ─────────────────────────────────────────────────────────

const SETUP_GPS_KEY = 'HADIN_SETUP_GPS';
const SETUP_AUDIO_KEY = 'HADIN_SETUP_AUDIO';
const SOS_PIN_KEY = 'HADIN_SOS_PIN';
const USER_MODE_KEY = 'HADIN_USER_MODE';

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

// ── HomeScreen ────────────────────────────────────────────────────────────────

const HomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { isOnline } = useNetworkStatus();

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

      const [activeTripRes, recentRes, contactsRes, tripContactsRes, profileRes] = await Promise.all([
        supabase.from('trips').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('trips').select('*').neq('status', 'active').order('created_at', { ascending: false }).limit(3),
        supabase.from('trusted_contacts').select('id, name, phone, relationship').order('created_at', { ascending: true }).limit(2),
        supabase.from('trusted_contacts').select('id, name, phone, relationship').order('created_at', { ascending: true }),
        supabase.from('profiles').select('plan, subscription_status').eq('id', userId).maybeSingle(),
      ]);

      const meta = user?.user_metadata as { full_name?: string } | undefined;
      setUserName(meta?.full_name ?? user?.email ?? '');
      setActiveTrip((activeTripRes.data as Trip | null) ?? null);
      setRecentTrips((recentRes.data as Trip[]) ?? []);
      setContacts((contactsRes.data as Contact[]) ?? []);
      setTripContacts((tripContactsRes.data ?? []) as CircleContact[]);

      const profileData = profileRes.data as { plan?: string } | null;
      const plan: UserPlan = profileData?.plan === 'elite' ? 'elite' : 'basic';
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

  // Reset SOS state when no active trip
  useEffect(() => {
    if (!activeTrip) {
      setTripContacts([]);
      setSosActive(false);
      setSosEventId(undefined);
      setSosTime(undefined);
      setSosNotified(0);
      setSosTotal(0);
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
    await Linking.openSettings().catch(() => null);
    await AsyncStorage.setItem(SETUP_AUDIO_KEY, 'done').catch(() => null);
    await checkSetupSteps();
  };

  const handleAudioSkip = async () => {
    await AsyncStorage.setItem(SETUP_AUDIO_KEY, 'skipped').catch(() => null);
    await checkSetupSteps();
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
    setToast({ visible: true, title: 'Trip started' });
  };

  const handleEndTrip = () => {
    if (!activeTrip) return;
    setShowEndModal(true);
  };

  const confirmEndTrip = async () => {
    if (!activeTrip) return;
    setShowEndModal(false);
    try {
      await supabase.from('trips').update({ status: 'completed', ended_at: new Date().toISOString() }).eq('id', activeTrip.id);
      await stopTracking();
      setActiveTrip(null);
      setSosActive(false);
      setSosEventId(undefined);
      await loadData();
    } catch {
      Alert.alert('Error', 'Could not end trip');
    }
  };

  // ── SOS handlers ────────────────────────────────────────────────────────────

  const handleSOSTap = async () => {
    if (!activeTrip || sosLoading || sosActive) return;
    setSosLoading(true);
    const firedAt = new Date();
    const result = await triggerSOS(activeTrip.id, activeTrip.contact_ids ?? []);
    setSosLoading(false);
    const timeStr = formatTime(firedAt.toISOString());
    setSosTime(timeStr);
    setSosNotified(result.notified);
    setSosTotal(result.total > 0 ? result.total : tripContacts.length);
    if (result.success) {
      setSosActive(true);
      setSosEventId(result.eventId);
    } else {
      setSosActive(false);
      setToast({ visible: true, title: 'SOS sent via SMS', duration: 4000 });
    }
  };

  const handleCancelSOS = async () => {
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
          onSOSTap={handleSOSTap}
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
        userName={userName}
        isOnline={isOnline}
        recentTrips={recentTrips}
        contacts={contacts}
        userPlan={userPlan}
        locationGranted={locationGranted}
        familyGroups={familyGroups}
        onStartTrip={handleStartTrip}
        onNavigateToCircle={() => navigation.navigate('Circle')}
        onAddCircleMember={() => navigation.navigate('Circle', { openAddModal: true })}
        onNavigateToRoutes={() => navigation.navigate('Routes')}
        onNavigateToSettings={() => navigation.navigate('Settings')}
      />
      <StartTripModal
        visible={showStartModal}
        onClose={() => setShowStartModal(false)}
        onTripStarted={handleTripStarted}
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
  onPinDigit: (d: string) => void;
  onPinBackspace: () => void;
}

const PIN_PAD = [['1','2','3'],['4','5','6'],['7','8','9'],['','0','⌫']] as const;

const SetupModal = ({
  step, pinInput, pinStage, pinError,
  onGpsEnable, onAudioEnable, onAudioSkip, onPinDigit, onPinBackspace,
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
                style={({ pressed }) => [smStyles.primaryBtn, pressed && smStyles.pressed]}
                onPress={onAudioEnable}
              >
                <Text style={smStyles.primaryBtnText}>Enable Microphone</Text>
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
            </>
          )}

        </View>
      </View>
    </Modal>
  );
};

// ── Idle view ─────────────────────────────────────────────────────────────────

interface IdleViewProps {
  userName: string;
  isOnline: boolean;
  recentTrips: Trip[];
  contacts: Contact[];
  userPlan: UserPlan;
  locationGranted: boolean;
  familyGroups: FamilyGroup[];
  onStartTrip: () => void;
  onNavigateToCircle: () => void;
  onAddCircleMember: () => void;
  onNavigateToRoutes: () => void;
  onNavigateToSettings: () => void;
}

const IdleView = ({
  userName, isOnline, recentTrips, contacts, userPlan, locationGranted, familyGroups,
  onStartTrip, onNavigateToCircle, onAddCircleMember, onNavigateToRoutes, onNavigateToSettings,
}: IdleViewProps) => {
  const insets = useSafeAreaInsets();
  const visibleContacts = contacts.slice(0, 2);
  const historyItems = recentTrips.slice(0, 2);

  // User mode toggle
  const [userMode, setUserMode] = useState<UserMode>('always_on');
  const [modeToggleWidth, setModeToggleWidth] = useState(0);
  const modeSlide = useRef(new Animated.Value(userMode === 'trip' ? 1 : 0)).current;
  const modeDragStart = useRef(userMode === 'trip' ? 1 : 0);
  const alwaysOnSub = useRef<Location.LocationSubscription | null>(null);
  const modeThumbWidth = modeToggleWidth > 0 ? (modeToggleWidth - 6) / 2 : 0;

  const animateModeTo = useCallback((mode: UserMode) => {
    Animated.spring(modeSlide, {
      toValue: mode === 'trip' ? 1 : 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 210,
      mass: 0.8,
    }).start();
  }, [modeSlide]);

  useEffect(() => {
    AsyncStorage.getItem(USER_MODE_KEY)
      .then((v) => { if (v === 'always_on' || v === 'trip') setUserMode(v); })
      .catch(() => null);
    return () => { alwaysOnSub.current?.remove(); };
  }, []);

  useEffect(() => {
    modeDragStart.current = userMode === 'trip' ? 1 : 0;
    animateModeTo(userMode);
  }, [animateModeTo, userMode]);

  const handleModeToggle = async (mode: UserMode) => {
    animateModeTo(mode);
    setUserMode(mode);
    await AsyncStorage.setItem(USER_MODE_KEY, mode).catch(() => null);

    if (mode === 'always_on') {
      // Start foreground location watcher for live map updates
      Location.getForegroundPermissionsAsync().then(({ status }) => {
        if (status !== 'granted') return;
        Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 60_000, distanceInterval: 100 },
          (pos) => {
            const { latitude, longitude } = pos.coords;
            setMapRegion({ latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 });
          },
        ).then((sub) => {
          alwaysOnSub.current?.remove();
          alwaysOnSub.current = sub;
        }).catch(() => null);
      }).catch(() => null);
    } else {
      alwaysOnSub.current?.remove();
      alwaysOnSub.current = null;
    }
  };

  const modePanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
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

  useEffect(() => {
    if (!locationGranted) return;
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then(async (pos) => {
        const { latitude, longitude } = pos.coords;
        setMapRegion({ latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 });
        const [addr] = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => [null]);
        if (addr) {
          const parts = [addr.city ?? addr.subregion, addr.region].filter(Boolean);
          setLocationName(parts.join(', ') || 'Current location');
        } else {
          setLocationName('Current location');
        }
      })
      .catch(() => null);
  }, [locationGranted]);

  return (
    <View style={styles.idleRoot}>
      <View style={[styles.dashboardTop, { paddingTop: insets.top + 8 }]}>
        <HadinLogo size={27} />
      </View>

      <ScrollView
        style={styles.idleScroll}
        contentContainerStyle={[styles.idleScrollContent, { paddingBottom: insets.bottom + 78 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Mode toggle */}
        <Pressable
          style={styles.modeRow}
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
            <Feather name="check-circle" size={15} color={userMode === 'always_on' ? colors.white : '#111827'} />
            <Text style={[styles.modeText, userMode === 'always_on' ? styles.modeTextActive : styles.modeTextInactive]}>
              Always On
            </Text>
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
              <Pressable style={styles.mapControlBtn}>
                <Feather name="sliders" size={20} color="#111827" />
              </Pressable>
              <Pressable
                style={styles.mapControlBtn}
                onPress={() => {
                  setMapRegion(NIGERIA_DEFAULT);
                }}
              >
                <Feather name="crosshair" size={20} color="#111827" />
              </Pressable>
              <Pressable style={styles.mapControlBtn}>
                <Feather name="phone" size={20} color="#111827" />
              </Pressable>
              <Pressable
                style={styles.sosFab}
                onPress={onStartTrip}
              >
                <Text style={styles.sosStar}>✱</Text>
                <Text style={styles.sosText}>SOS</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* My Safety Circle */}
        <View style={styles.safetyCircleSection}>
          <DashboardSection title="My Safety Circle" action="View All" onAction={onNavigateToCircle}>
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
        <DashboardSection title="History" action="View All" onAction={onNavigateToRoutes}>
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
        <DashboardSection title="Family Groups" action="View All" onAction={onNavigateToCircle}>
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
        <TabBarItem icon="users" label="Circle" onPress={onNavigateToCircle} />
        <TabBarItem icon="clock" label="History" onPress={onNavigateToRoutes} />
        <TabBarItem icon="user" label="Profile" onPress={onNavigateToSettings} />
      </View>
    </View>
  );
};

// ── Section wrapper ───────────────────────────────────────────────────────────

interface DashboardSectionProps {
  title: string;
  action: string;
  onAction: () => void;
  children: React.ReactNode;
}

const DashboardSection = ({ title, action, onAction, children }: DashboardSectionProps) => (
  <View style={styles.dashboardSection}>
    <View style={styles.dashboardSectionHeader}>
      <Text style={styles.dashboardSectionTitle}>{title}</Text>
      <Pressable style={styles.dashboardSectionAction} onPress={onAction}>
        <Text style={styles.dashboardSectionActionText}>{action}</Text>
        <Feather name="chevron-right" size={14} color="#6B21A8" />
      </Pressable>
    </View>
    <View style={styles.dashboardSectionBody}>{children}</View>
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

  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    function compute() {
      const ms = Date.now() - new Date(trip.created_at).getTime();
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`);
    }
    compute();
    const id = setInterval(compute, 60_000);
    return () => clearInterval(id);
  }, [trip.created_at]);

  const handleBackground = () => {
    if (Platform.OS === 'android') {
      BackHandler.exitApp();
    } else {
      Alert.alert('Background Hadin', 'Swipe up and go home to background Hadin. Your trip is still active.');
    }
  };

  const started = trip.started_at ?? trip.created_at;
  const startedStr = formatTime(started);
  const metaStr = [
    `Started ${startedStr}`,
    trip.expected_stops ? `${trip.expected_stops} stop${trip.expected_stops !== 1 ? 's' : ''}` : null,
    trip.max_stop_duration_minutes ? `${trip.max_stop_duration_minutes}m max` : null,
  ].filter(Boolean).join(' · ');

  const visibleContacts = tripContacts.slice(0, 2);
  const overflowContacts = tripContacts.slice(2);

  return (
    <View style={[atStyles.root, { paddingTop: insets.top }]}>
      {sosActive ? (
        <View style={atStyles.sosBanner}>
          <View style={atStyles.sosBannerDot} />
          <Text style={atStyles.sosBannerTxt}>SOS alert sent</Text>
          {sosTime ? <Text style={atStyles.sosBannerTime}>{sosTime}</Text> : null}
        </View>
      ) : (
        <View style={atStyles.banner}>
          <View style={atStyles.bannerLeft}>
            <View style={atStyles.bannerDot} />
            <Text style={atStyles.bannerTxt}>Trip active</Text>
          </View>
          <View style={atStyles.bannerRight}>
            {elapsed ? <Text style={atStyles.bannerTimer}>{elapsed}</Text> : null}
            <Pressable
              style={({ pressed }) => [atStyles.bgChip, pressed && { opacity: 0.7 }]}
              onPress={handleBackground}
            >
              <Feather name="minimize-2" size={13} color="rgba(255,255,255,0.85)" />
              <Text style={atStyles.bgChipTxt}>Background</Text>
            </Pressable>
          </View>
        </View>
      )}

      <View style={atStyles.routeHdr}>
        <Text style={atStyles.routeText} numberOfLines={1}>
          {trip.origin ?? '—'}  →  {trip.destination ?? '—'}
        </Text>
        <Text style={atStyles.routeMeta}>
          {sosActive ? 'SOS triggered · Trip still active' : metaStr}
        </Text>
      </View>

      <ScrollView
        style={atStyles.scroll}
        contentContainerStyle={[atStyles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {!sosActive && (
          <View style={atStyles.statRow}>
            <View style={atStyles.statBox}>
              <Text style={atStyles.statVal}>{elapsed || '0m'}</Text>
              <Text style={atStyles.statKey}>Elapsed</Text>
            </View>
            <View style={atStyles.statBox}>
              <Text style={atStyles.statVal}>0</Text>
              <Text style={atStyles.statKey}>Pings</Text>
            </View>
            <View style={atStyles.statBox}>
              <Text style={atStyles.statVal}>{trip.expected_stops}</Text>
              <Text style={atStyles.statKey}>Stops</Text>
            </View>
            <View style={atStyles.statBox}>
              <Text style={atStyles.statVal}>{trip.max_stop_duration_minutes}m</Text>
              <Text style={atStyles.statKey}>Max stop</Text>
            </View>
          </View>
        )}

        {!sosActive && (
          <View style={atStyles.card}>
            <Text style={atStyles.cardLbl}>Last known location</Text>
            {lastPing ? (
              <>
                <View style={atStyles.locRow}>
                  <Text style={atStyles.locKey}>Coordinates</Text>
                  <Text style={atStyles.locVal}>{lastPing.lat.toFixed(4)}°N, {lastPing.lng.toFixed(4)}°E</Text>
                </View>
                <View style={[atStyles.locRow, atStyles.locRowLast]}>
                  <Text style={atStyles.locKey}>Updated</Text>
                  <Text style={atStyles.locVal}>{formatTime(lastPing.timestamp)}</Text>
                </View>
              </>
            ) : (
              <Text style={atStyles.locWait}>Waiting for first ping…</Text>
            )}
            <View style={atStyles.locNote}>
              <Feather name="lock" size={12} color={colors.brand.border} />
              <Text style={atStyles.locNoteTxt}>Shared with your circle only when you send SOS</Text>
            </View>
          </View>
        )}

        {sosActive && (
          <View style={atStyles.card}>
            <Text style={atStyles.cardLbl}>Alert details</Text>
            <View style={atStyles.alertRow}>
              <Text style={atStyles.alertKey}>Time</Text>
              <Text style={atStyles.alertVal}>{sosTime}</Text>
            </View>
            <View style={atStyles.alertRow}>
              <Text style={atStyles.alertKey}>Contacts reached</Text>
              <Text style={[atStyles.alertVal, atStyles.alertValGreen]}>{sosNotified} of {sosTotal}</Text>
            </View>
            <View style={[atStyles.alertRow, atStyles.alertRowLast]}>
              <Text style={atStyles.alertKey}>Delivered via</Text>
              <Text style={[atStyles.alertVal, atStyles.alertValGreen]}>{sosNotified > 0 ? 'SMS' : 'SMS (fallback)'}</Text>
            </View>
          </View>
        )}

        {sosActive && tripContacts.length > 0 && (
          <View style={atStyles.card}>
            <Text style={atStyles.cardLbl}>Notified</Text>
            {tripContacts.map((c, i) => {
              const pal = avatarColors(i);
              return (
                <View key={c.id} style={[atStyles.nrRow, i === tripContacts.length - 1 && atStyles.nrRowLast]}>
                  <View style={[atStyles.ciAv, { backgroundColor: pal.bg }]}>
                    <Text style={[atStyles.ciAvTxt, { color: pal.fg }]}>{initials(c.name)}</Text>
                  </View>
                  <Text style={atStyles.nrName}>{c.name}</Text>
                  <View style={atStyles.nrBadge}>
                    <Text style={atStyles.nrBadgeTxt}>SMS sent</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {!sosActive && (
          <View style={atStyles.card}>
            <View style={atStyles.sbTop}>
              <View style={atStyles.sbLeft}>
                <View style={atStyles.sbDot} />
                <Text style={atStyles.sbTitle}>Circle on standby</Text>
              </View>
              {tripContacts.length > 0 && (
                <View style={atStyles.sbPill}>
                  <Text style={atStyles.sbPillTxt}>{tripContacts.length} contact{tripContacts.length !== 1 ? 's' : ''}</Text>
                </View>
              )}
            </View>

            {tripContacts.length === 0 ? (
              <Text style={atStyles.emptyCircleTxt}>Add contacts to your circle →</Text>
            ) : (
              <>
                {visibleContacts.map((c, i) => {
                  const pal = avatarColors(i);
                  return (
                    <View key={c.id} style={[atStyles.ciRow, i === visibleContacts.length - 1 && overflowContacts.length === 0 && atStyles.ciRowLast]}>
                      <View style={[atStyles.ciAv, { backgroundColor: pal.bg }]}>
                        <Text style={[atStyles.ciAvTxt, { color: pal.fg }]}>{initials(c.name)}</Text>
                      </View>
                      <View style={atStyles.ciInfo}>
                        <Text style={atStyles.ciName}>{c.name}</Text>
                        <Text style={atStyles.ciRel}>{c.relationship ?? 'Contact'}</Text>
                      </View>
                      <Text style={atStyles.ciStatus}>On standby</Text>
                    </View>
                  );
                })}
                {overflowContacts.length > 0 && (
                  <View style={atStyles.overflowRow}>
                    <View style={atStyles.stackedAvatars}>
                      {overflowContacts.slice(0, 3).map((c, i) => {
                        const pal = avatarColors(i + 2);
                        return (
                          <View key={c.id} style={[atStyles.stackedAv, { backgroundColor: pal.bg, zIndex: 3 - i }]}>
                            <Text style={[atStyles.stackedAvTxt, { color: pal.fg }]}>{initials(c.name)}</Text>
                          </View>
                        );
                      })}
                    </View>
                    <Text style={atStyles.moreLbl}>
                      <Text style={atStyles.moreLblBold}>{overflowContacts.length} more</Text>
                      {' watching over you'}
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {!sosActive && (
          <Pressable
            style={({ pressed }) => [atStyles.sosBtn, pressed && !sosLoading && { opacity: 0.85 }, sosLoading && { opacity: 0.6 }]}
            onPress={onSOSTap}
            disabled={sosLoading}
          >
            <View style={atStyles.sosIconCircle}>
              {sosLoading ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Feather name="alert-triangle" size={18} color={colors.white} />
              )}
            </View>
            <View style={atStyles.sosTextBlock}>
              <Text style={atStyles.sosTitle}>Send SOS alert</Text>
              <Text style={atStyles.sosSub}>Notifies all {tripContacts.length} contact{tripContacts.length !== 1 ? 's' : ''} instantly</Text>
            </View>
            <Feather name="chevron-right" size={20} color="rgba(255,255,255,0.55)" />
          </Pressable>
        )}

        {sosActive && (
          <Pressable
            style={({ pressed }) => [atStyles.cancelBtn, pressed && { opacity: 0.8 }]}
            onPress={onCancelSOS}
          >
            <Text style={atStyles.cancelTxt}>I'm safe — cancel this alert</Text>
          </Pressable>
        )}

        <Pressable
          style={({ pressed }) => [atStyles.endBtn, pressed && { opacity: 0.7 }]}
          onPress={onEndTrip}
        >
          <Text style={atStyles.endTxt}>{sosActive ? 'End trip' : "I've arrived safely — end trip"}</Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.atTabBar, { paddingBottom: insets.bottom || spacing.gap8 }]}>
        <TabBarItem icon="grid" label="Dashboard" active />
        <TabBarItem icon="users" label="Circle" onPress={onNavigateToCircle} />
        <TabBarItem icon="clock" label="History" onPress={onNavigateToRoutes} />
        <TabBarItem icon="user" label="Profile" onPress={onNavigateToSettings} />
      </View>
    </View>
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
      const ms = Date.now() - new Date(trip.created_at).getTime();
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
              <Feather name="navigation" size={13} color="rgba(255,255,255,0.5)" />
              <Text style={etStyles.routeTxt} numberOfLines={1}>{trip.origin ?? '—'}  →  {trip.destination ?? '—'}</Text>
            </View>
            <Text style={etStyles.metaTxt}>
              {[elapsed, contactCount > 0 ? `${contactCount} contact${contactCount !== 1 ? 's' : ''}` : null].filter(Boolean).join('  ·  ')}
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
  overlay: { flex: 1, backgroundColor: 'rgba(10,26,17,0.75)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  card: { width: '100%', backgroundColor: '#0E1F17', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, backgroundColor: '#142C1F' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  routeTxt: { fontSize: 16, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3, flex: 1 },
  metaTxt: { fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: '500' },
  divider: { height: 0.5, backgroundColor: 'rgba(255,255,255,0.08)' },
  body: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  headline: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  subtext: { fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 19 },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1A6B4A', marginHorizontal: 20, marginTop: 20, borderRadius: 12, paddingVertical: 14 },
  confirmTxt: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  cancelLink: { alignItems: 'center', paddingVertical: 16 },
  cancelLinkTxt: { fontSize: 13, color: 'rgba(255,255,255,0.35)', fontWeight: '500' },
});

// ── Tab bar item ──────────────────────────────────────────────────────────────

interface TabBarItemProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  active?: boolean;
  dark?: boolean;
  onPress?: () => void;
}

const TabBarItem = ({ icon, label, active = false, dark = false, onPress }: TabBarItemProps) => (
  <Pressable style={styles.tabItem} onPress={onPress}>
    <Feather name={icon} size={22} color={active ? (dark ? colors.brand.mid : '#6B21A8') : (dark ? 'rgba(255,255,255,0.35)' : colors.brand.textSecondary)} />
    {active && <View style={[styles.tabActiveLine, dark && styles.tabActiveLineDark]} />}
    <Text style={[styles.tabLabel, active && (dark ? styles.tabLabelActiveDark : styles.tabLabelActive), !active && dark && styles.tabLabelInactiveDark]}>
      {label}
    </Text>
  </Pressable>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.brand.bgWarm },

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
  upgradeBadge: { backgroundColor: '#6B21A8', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
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
  root: { flex: 1, backgroundColor: '#F4F3EF' },
  banner: { backgroundColor: '#1A6B4A', paddingHorizontal: 16, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bannerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ADE80' },
  bannerTxt: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  bannerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerTimer: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: '500' },
  bgChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8 },
  bgChipTxt: { fontSize: 10, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },
  sosBanner: { backgroundColor: '#C0392B', paddingHorizontal: 16, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 7 },
  sosBannerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF', flexShrink: 0 },
  sosBannerTxt: { fontSize: 11, fontWeight: '700', color: '#FFFFFF', flex: 1 },
  sosBannerTime: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  routeHdr: { backgroundColor: '#FFFFFF', paddingHorizontal: 17, paddingTop: 11, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: '#EEECE6' },
  routeText: { fontSize: 19, fontWeight: '800', color: '#1A1A1A', letterSpacing: -0.5, marginBottom: 2 },
  routeMeta: { fontSize: 11, color: '#9C9A92' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 13, paddingTop: 11, gap: 9 },
  statRow: { flexDirection: 'row', gap: 7 },
  statBox: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 5, alignItems: 'center', borderWidth: 0.5, borderColor: '#EEECE6' },
  statVal: { fontSize: 17, fontWeight: '800', color: '#1A1A1A', letterSpacing: -0.5 },
  statKey: { fontSize: 10, color: '#9C9A92', marginTop: 2 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 0.5, borderColor: '#EEECE6' },
  cardLbl: { fontSize: 10, fontWeight: '700', color: '#9C9A92', letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 9 },
  locRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#F4F3EF' },
  locRowLast: { borderBottomWidth: 0 },
  locKey: { fontSize: 11, color: '#9C9A92' },
  locVal: { fontSize: 11, color: '#1A1A1A', fontWeight: '500' },
  locWait: { fontSize: 13, color: '#B4B2A9', fontStyle: 'italic', marginBottom: 5 },
  locNote: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  locNoteTxt: { fontSize: 11, color: '#B4B2A9' },
  alertRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#F4F3EF' },
  alertRowLast: { borderBottomWidth: 0 },
  alertKey: { fontSize: 11, color: '#9C9A92' },
  alertVal: { fontSize: 11, fontWeight: '600', color: '#1A1A1A' },
  alertValGreen: { color: '#1D9E75' },
  nrRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#F4F3EF' },
  nrRowLast: { borderBottomWidth: 0 },
  nrName: { fontSize: 12, fontWeight: '500', color: '#1A1A1A', flex: 1 },
  nrBadge: { backgroundColor: '#EFF9F4', borderRadius: 6, paddingVertical: 2, paddingHorizontal: 7, borderWidth: 0.5, borderColor: '#B8E8D0' },
  nrBadgeTxt: { fontSize: 10, color: '#0F6E56', fontWeight: '600' },
  sbTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sbLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sbDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#1D9E75' },
  sbTitle: { fontSize: 13, fontWeight: '600', color: '#1A1A1A' },
  sbPill: { backgroundColor: '#EFF9F4', borderRadius: 20, paddingVertical: 3, paddingHorizontal: 8, borderWidth: 0.5, borderColor: '#B8E8D0' },
  sbPillTxt: { fontSize: 10, color: '#0F6E56', fontWeight: '600' },
  emptyCircleTxt: { fontSize: fontSizes.caption, color: colors.brand.primary, fontWeight: '600' },
  ciRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#F4F3EF' },
  ciRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  ciAv: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  ciAvTxt: { fontSize: 9, fontWeight: '700' },
  ciInfo: { flex: 1 },
  ciName: { fontSize: 12, fontWeight: '600', color: '#1A1A1A' },
  ciRel: { fontSize: 10, color: '#9C9A92' },
  ciStatus: { fontSize: 10, color: '#1D9E75', fontWeight: '500' },
  overflowRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 7, borderTopWidth: 0.5, borderTopColor: '#F4F3EF', marginTop: 2 },
  stackedAvatars: { flexDirection: 'row' },
  stackedAv: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#FFFFFF', marginRight: -5, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  stackedAvTxt: { fontSize: 8, fontWeight: '700' },
  moreLbl: { fontSize: 11, color: '#9C9A92', marginLeft: 12 },
  moreLblBold: { color: '#1A6B4A', fontWeight: '600' },
  sosBtn: { backgroundColor: '#C0392B', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 13 },
  sosIconCircle: { width: 38, height: 38, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 19, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  sosTextBlock: { flex: 1 },
  sosTitle: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  sosSub: { fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  cancelBtn: { backgroundColor: '#FEF2F2', borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 0.5, borderColor: '#F7C1C1' },
  cancelTxt: { fontSize: 12, color: '#A32D2D', fontWeight: '600' },
  endBtn: { backgroundColor: '#FFFFFF', borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 0.5, borderColor: '#EEECE6' },
  endTxt: { fontSize: 12, color: '#9C9A92', fontWeight: '500' },
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
  skipBtn: { width: '100%', paddingVertical: 12, alignItems: 'center', marginBottom: 4 },
  skipBtnText: { fontSize: fontSizes.caption, color: colors.brand.textSecondary, fontWeight: '600' },
  pressed: { opacity: 0.8 },

  // PIN
  pinDots: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  pinDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#D1D5DB', backgroundColor: 'transparent' },
  pinDotFilled: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  pinError: { fontSize: 12, color: colors.brand.sos, marginBottom: 8, textAlign: 'center' },
  numpad: { width: '100%', gap: 8, marginBottom: 12 },
  numpadRow: { flexDirection: 'row', gap: 8 },
  numpadKey: { flex: 1, height: 60, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  numpadKeyText: { fontSize: 22, fontWeight: '600', color: colors.brand.textPrimary },
  numpadPressed: { backgroundColor: '#E5E7EB' },
});

export default HomeScreen;

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppStackParamList } from '../../navigation/AppNavigator';
import { supabase } from '../../lib/supabase';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { stopTracking, getLastPing, LocationPing } from '../../services/LocationService';
import { triggerSOS, cancelSOS, SOSContact } from '../../services/SOSService';
import { getContacts } from '../../services/CircleService';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import StartTripModal, { Trip } from './StartTripModal';
import SuccessToast from '../../components/SuccessToast';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Contact {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
}

// Extends SOSContact with the relationship field we fetch for display
interface CircleContact extends SOSContact {
  relationship?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0] ?? fullName;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

// Deterministic avatar colours so the same contact always gets the same palette entry
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

// ── HomeScreen ────────────────────────────────────────────────────────────────

const HomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { isOnline } = useNetworkStatus();

  const [userName, setUserName] = useState('');
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [recentTrips, setRecentTrips] = useState<Trip[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [lastPing, setLastPing] = useState<LocationPing | null>(null);
  const [loading, setLoading] = useState(true);
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

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [{ data: { user } }, activeTripRes, recentRes, contactsRes, tripContactsRes] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from('trips')
          .select('*')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('trips')
          .select('*')
          .neq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(3),
        supabase
          .from('trusted_contacts')
          .select('id, name, phone, relationship')
          .order('created_at', { ascending: true })
          .limit(2),
        supabase
          .from('trusted_contacts')
          .select('id, name, phone, relationship')
          .order('created_at', { ascending: true }),
      ]);

      const meta = user?.user_metadata as { full_name?: string } | undefined;
      setUserName(meta?.full_name ?? user?.email ?? '');
      setActiveTrip((activeTripRes.data as Trip | null) ?? null);
      setRecentTrips((recentRes.data as Trip[]) ?? []);
      setContacts((contactsRes.data as Contact[]) ?? []);
      setTripContacts((tripContactsRes.data ?? []) as CircleContact[]);

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

  // Realtime: watch trips table for status changes.
  // Unique channel name per mount prevents the "cannot add callbacks after subscribe()" error
  // that fires in StrictMode or when navigating back to this screen.
  useEffect(() => {
    const channel = supabase
      .channel(`home-trips-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => {
        loadData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

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

  // ── Trip actions ────────────────────────────────────────────────────────────

  const handleStartTrip = async () => {
    const circle = await getContacts();
    if (circle.length === 0) {
      Alert.alert(
        'Add contacts first',
        'You need at least one person in your circle before starting a trip. They will be notified if you send an SOS.',
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
      await supabase
        .from('trips')
        .update({ status: 'completed', ended_at: new Date().toISOString() })
        .eq('id', activeTrip.id);
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
      // SOSService opened the native SMS app as fallback — show toast when user returns
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
        <Text style={styles.loadingText}>Loading…</Text>
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
        onStartTrip={handleStartTrip}
        onNavigateToCircle={() => navigation.navigate('Circle')}
        onNavigateToRoutes={() => navigation.navigate('Routes')}
        onNavigateToSettings={() => navigation.navigate('Settings')}
      />
      <StartTripModal
        visible={showStartModal}
        onClose={() => setShowStartModal(false)}
        onTripStarted={handleTripStarted}
      />
    </>
  );
};

// ── Idle state ─────────────────────────────────────────────────────────────────

interface IdleViewProps {
  userName: string;
  isOnline: boolean;
  recentTrips: Trip[];
  contacts: Contact[];
  onStartTrip: () => void;
  onNavigateToCircle: () => void;
  onNavigateToRoutes: () => void;
  onNavigateToSettings: () => void;
}

const IdleView = ({ userName, isOnline, recentTrips, contacts, onStartTrip, onNavigateToCircle, onNavigateToRoutes, onNavigateToSettings }: IdleViewProps) => {
  const insets = useSafeAreaInsets();
  return (
  <View style={styles.idleRoot}>
    {/* Header */}
    <View style={[styles.idleHeader, { paddingTop: insets.top + 10 }]}>
      <View>
        <Text style={styles.idleGreeting}>{greeting()},</Text>
        <Text style={styles.idleName}>{firstName(userName) || 'Traveller'}</Text>
      </View>
      <View style={styles.headerRight}>
        <View style={[styles.statusPill, isOnline ? styles.statusPillOnline : styles.statusPillOffline]}>
          <View style={[styles.statusDot, isOnline ? styles.statusDotOnline : styles.statusDotOffline]} />
          <Text style={[styles.statusPillText, isOnline ? styles.statusPillTextOnline : styles.statusPillTextOffline]}>
            {isOnline ? 'All safe · Online' : 'Offline'}
          </Text>
        </View>
        {userName ? (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(userName)}</Text>
          </View>
        ) : null}
      </View>
    </View>

    <ScrollView style={styles.idleScroll} contentContainerStyle={styles.idleScrollContent} showsVerticalScrollIndicator={false}>
      {/* Hero card */}
      <View style={styles.heroCard}>
        <Text style={styles.heroEyebrow}>TRAVEL SAFE</Text>
        <Text style={styles.heroHeadline}>Your people travel{'\n'}with you in spirit.</Text>
        <Text style={styles.heroSubtitle}>
          Track every leg of your journey. Your circle sees you live — so you never travel alone.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.heroCta, pressed && styles.heroCtaPressed]}
          onPress={contacts.length === 0 ? onNavigateToCircle : onStartTrip}
        >
          <Text style={styles.heroCtaText}>
            {contacts.length === 0 ? 'Add a contact first →' : 'Start a trip  →'}
          </Text>
        </Pressable>
      </View>

      {/* Recent journeys */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Recent journeys</Text>
        {recentTrips.length === 0 ? (
          <Text style={styles.emptyText}>No trips yet. Start your first journey.</Text>
        ) : (
          recentTrips.map((trip) => (
            <View key={trip.id} style={styles.tripRow}>
              <View style={styles.tripRouteIcon}>
                <Feather name="map-pin" size={14} color={colors.brand.primary} />
              </View>
              <View style={styles.tripRowMid}>
                <Text style={styles.tripRoute} numberOfLines={1}>
                  {trip.origin ?? '—'}  →  {trip.destination ?? '—'}
                </Text>
                <Text style={styles.tripMeta}>
                  {formatDate(trip.created_at)}
                  {trip.expected_duration_minutes ? `  ·  ${trip.expected_duration_minutes}min` : ''}
                </Text>
              </View>
              <View style={[styles.tripBadge, trip.status === 'sos' ? styles.tripBadgeSOS : styles.tripBadgeSafe]}>
                <Text style={[styles.tripBadgeText, trip.status === 'sos' ? styles.tripBadgeTextSOS : styles.tripBadgeTextSafe]}>
                  {trip.status === 'sos' ? 'SOS' : 'Safe'}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Your circle */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Your circle</Text>
        {contacts.length === 0 ? (
          <Text style={styles.emptyText}>Add trusted contacts who will be notified when you travel.</Text>
        ) : (
          contacts.map((c) => (
            <View key={c.id} style={styles.contactRow}>
              <View style={styles.contactAvatar}>
                <Text style={styles.contactAvatarText}>{initials(c.name)}</Text>
              </View>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{c.name}</Text>
                <Text style={styles.contactSub}>
                  {c.relationship ?? 'Contact'}  ·  will be notified
                </Text>
              </View>
            </View>
          ))
        )}
        <Pressable style={styles.addContactRow} onPress={onNavigateToCircle}>
          <Feather name="plus-circle" size={16} color={colors.brand.primary} />
          <Text style={styles.addContactText}>Add a trusted contact</Text>
        </Pressable>
      </View>
    </ScrollView>

    {/* Bottom tab bar */}
    <View style={[styles.tabBar, { paddingBottom: insets.bottom || spacing.gap8 }]}>
      <TabBarItem icon="home" label="Home" active />
      <TabBarItem icon="map" label="Routes" onPress={onNavigateToRoutes} />
      <TabBarItem icon="users" label="Circle" onPress={onNavigateToCircle} />
      <TabBarItem icon="settings" label="Settings" onPress={onNavigateToSettings} />
    </View>
  </View>
  );
};

// ── Active trip state ─────────────────────────────────────────────────────────

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
  trip,
  tripContacts,
  lastPing,
  sosLoading,
  sosActive,
  sosTime,
  sosNotified,
  sosTotal,
  onSOSTap,
  onCancelSOS,
  onEndTrip,
  onNavigateToCircle,
  onNavigateToRoutes,
  onNavigateToSettings,
}: ActiveTripViewProps) => {
  const insets = useSafeAreaInsets();

  // Elapsed timer — updates every minute
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
      Alert.alert(
        'Background Hadin',
        'Swipe up and go home to background Hadin. Your trip is still active.',
      );
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

      {/* ── Banner ─────────────────────────────────────────────────────────── */}
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

      {/* ── Route header ───────────────────────────────────────────────────── */}
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

        {/* ── Stat row (normal state) ──────────────────────────────────────── */}
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

        {/* ── Location card (normal state) ─────────────────────────────────── */}
        {!sosActive && (
          <View style={atStyles.card}>
            <Text style={atStyles.cardLbl}>Last known location</Text>
            {lastPing ? (
              <>
                <View style={atStyles.locRow}>
                  <Text style={atStyles.locKey}>Coordinates</Text>
                  <Text style={atStyles.locVal}>
                    {lastPing.lat.toFixed(4)}°N, {lastPing.lng.toFixed(4)}°E
                  </Text>
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

        {/* ── SOS alert details (SOS sent state) ───────────────────────────── */}
        {sosActive && (
          <View style={atStyles.card}>
            <Text style={atStyles.cardLbl}>Alert details</Text>
            <View style={atStyles.alertRow}>
              <Text style={atStyles.alertKey}>Time</Text>
              <Text style={atStyles.alertVal}>{sosTime}</Text>
            </View>
            <View style={atStyles.alertRow}>
              <Text style={atStyles.alertKey}>Contacts reached</Text>
              <Text style={[atStyles.alertVal, atStyles.alertValGreen]}>
                {sosNotified} of {sosTotal}
              </Text>
            </View>
            <View style={[atStyles.alertRow, atStyles.alertRowLast]}>
              <Text style={atStyles.alertKey}>Delivered via</Text>
              <Text style={[atStyles.alertVal, atStyles.alertValGreen]}>
                {sosNotified > 0 ? 'SMS' : 'SMS (fallback)'}
              </Text>
            </View>
          </View>
        )}

        {/* ── Notified contacts (SOS sent state) ───────────────────────────── */}
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

        {/* ── Circle on standby (normal state) ─────────────────────────────── */}
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
              <Pressable onPress={onNavigateToCircle}>
                <Text style={atStyles.emptyCircleTxt}>Add contacts to your circle →</Text>
              </Pressable>
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

        {/* ── SOS button (normal state) ─────────────────────────────────────── */}
        {!sosActive && (
          <Pressable
            style={({ pressed }) => [
              atStyles.sosBtn,
              pressed && !sosLoading && { opacity: 0.85 },
              sosLoading && { opacity: 0.6 },
            ]}
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
              <Text style={atStyles.sosSub}>
                Notifies all {tripContacts.length} contact{tripContacts.length !== 1 ? 's' : ''} instantly
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color="rgba(255,255,255,0.55)" />
          </Pressable>
        )}

        {/* ── Cancel SOS (SOS sent state) ───────────────────────────────────── */}
        {sosActive && (
          <Pressable
            style={({ pressed }) => [atStyles.cancelBtn, pressed && { opacity: 0.8 }]}
            onPress={onCancelSOS}
          >
            <Text style={atStyles.cancelTxt}>I'm safe — cancel this alert</Text>
          </Pressable>
        )}

        {/* ── End trip ─────────────────────────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [atStyles.endBtn, pressed && { opacity: 0.7 }]}
          onPress={onEndTrip}
        >
          <Text style={atStyles.endTxt}>
            {sosActive ? 'End trip' : "I've arrived safely — end trip"}
          </Text>
        </Pressable>

      </ScrollView>

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <View style={[styles.atTabBar, { paddingBottom: insets.bottom || spacing.gap8 }]}>
        <TabBarItem icon="home" label="Home" active />
        <TabBarItem icon="map" label="Routes" onPress={onNavigateToRoutes} />
        <TabBarItem icon="users" label="Circle" onPress={onNavigateToCircle} />
        <TabBarItem icon="settings" label="Settings" onPress={onNavigateToSettings} />
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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      {/* Overlay — tap to dismiss */}
      <Pressable style={etStyles.overlay} onPress={onCancel}>
        {/* Card — swallow taps so they don't hit the overlay */}
        <Pressable style={etStyles.card} onPress={() => {}}>

          {/* ── Trip summary header ───────────────────────────────────────── */}
          <View style={etStyles.header}>
            <View style={etStyles.routeRow}>
              <Feather name="navigation" size={13} color="rgba(255,255,255,0.5)" />
              <Text style={etStyles.routeTxt} numberOfLines={1}>
                {trip.origin ?? '—'}  →  {trip.destination ?? '—'}
              </Text>
            </View>
            <Text style={etStyles.metaTxt}>
              {[
                elapsed,
                contactCount > 0 ? `${contactCount} contact${contactCount !== 1 ? 's' : ''}` : null,
              ].filter(Boolean).join('  ·  ')}
            </Text>
          </View>

          {/* ── Divider ──────────────────────────────────────────────────── */}
          <View style={etStyles.divider} />

          {/* ── Body ─────────────────────────────────────────────────────── */}
          <View style={etStyles.body}>
            <Text style={etStyles.headline}>End this trip?</Text>
            <Text style={etStyles.subtext}>
              {contactCount > 0
                ? 'Your circle will be notified you arrived safely.'
                : 'GPS tracking will stop and your trip will be marked complete.'}
            </Text>
          </View>

          {/* ── Primary CTA ───────────────────────────────────────────────── */}
          <Pressable
            style={({ pressed }) => [etStyles.confirmBtn, pressed && { opacity: 0.85 }]}
            onPress={onConfirm}
          >
            <Feather name="check" size={18} color="#FFFFFF" />
            <Text style={etStyles.confirmTxt}>Yes, I'm safe</Text>
          </Pressable>

          {/* ── Cancel link ───────────────────────────────────────────────── */}
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
    backgroundColor: 'rgba(10,26,17,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    backgroundColor: '#0E1F17',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: '#142C1F',
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  routeTxt: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    flex: 1,
  },
  metaTxt: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '500',
  },

  divider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  // Body
  body: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  headline: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtext: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 19,
  },

  // Confirm button
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1A6B4A',
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 12,
    paddingVertical: 14,
  },
  confirmTxt: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Cancel link
  cancelLink: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  cancelLinkTxt: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
    fontWeight: '500',
  },
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
    <Feather
      name={icon}
      size={22}
      color={
        active
          ? dark ? colors.brand.mid : colors.brand.primary
          : dark ? 'rgba(255,255,255,0.35)' : colors.brand.textSecondary
      }
    />
    {active && <View style={[styles.tabActiveLine, dark && styles.tabActiveLineDark]} />}
    <Text style={[
      styles.tabLabel,
      active && (dark ? styles.tabLabelActiveDark : styles.tabLabelActive),
      !active && dark && styles.tabLabelInactiveDark,
    ]}>
      {label}
    </Text>
  </Pressable>
);

// ── Shared styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.brand.bgWarm,
  },
  loadingText: {
    color: colors.brand.textSecondary,
    fontSize: fontSizes.body,
  },

  // ── Idle ──────────────────────────────────────────────────────────────────
  idleRoot: { flex: 1, backgroundColor: colors.brand.bgSurface },
  idleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.gap12,
    backgroundColor: colors.brand.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: colors.brand.border,
  },
  idleGreeting: {
    fontSize: fontSizes.caption,
    color: colors.brand.textSecondary,
    letterSpacing: 0.2,
  },
  idleName: {
    fontSize: fontSizes.subheading,
    fontWeight: '700',
    color: colors.brand.textPrimary,
    marginTop: 2,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.gap8 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.gap8,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 5,
  },
  statusPillOnline: { backgroundColor: colors.brand.light },
  statusPillOffline: { backgroundColor: '#FFF8E6' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotOnline: { backgroundColor: colors.brand.primary },
  statusDotOffline: { backgroundColor: '#D97706' },
  statusPillText: { fontSize: fontSizes.small, fontWeight: '600' },
  statusPillTextOnline: { color: colors.brand.primary },
  statusPillTextOffline: { color: '#D97706' },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brand.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: colors.white, fontSize: fontSizes.caption, fontWeight: '700' },

  idleScroll: { flex: 1 },
  idleScrollContent: { paddingHorizontal: spacing.screenPadding, paddingTop: spacing.gap16, paddingBottom: 100 },

  // Hero
  heroCard: {
    backgroundColor: colors.brand.primary,
    borderRadius: spacing.borderRadiusLg,
    padding: spacing.screenPadding,
    marginBottom: spacing.gap16,
  },
  heroEyebrow: {
    fontSize: fontSizes.small,
    fontWeight: '700',
    color: colors.brand.mid,
    letterSpacing: 1.2,
    marginBottom: spacing.gap8,
  },
  heroHeadline: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.white,
    lineHeight: 34,
    marginBottom: spacing.gap12,
  },
  heroSubtitle: {
    fontSize: fontSizes.caption,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 20,
    marginBottom: spacing.gap20,
  },
  heroCta: {
    backgroundColor: colors.white,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.gap20,
    paddingVertical: spacing.gap12,
    borderRadius: spacing.borderRadius,
  },
  heroCtaPressed: { opacity: 0.85 },
  heroCtaText: {
    color: colors.brand.primary,
    fontSize: fontSizes.body,
    fontWeight: '700',
  },

  // Section cards
  sectionCard: {
    backgroundColor: colors.brand.bgCard,
    borderRadius: spacing.borderRadiusLg,
    padding: spacing.gap16,
    marginBottom: spacing.gap16,
    borderWidth: 1,
    borderColor: colors.brand.border,
  },
  sectionTitle: {
    fontSize: fontSizes.caption,
    fontWeight: '700',
    color: colors.brand.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.gap12,
  },
  emptyText: {
    fontSize: fontSizes.caption,
    color: colors.brand.textSecondary,
    lineHeight: 20,
  },

  // Trip rows
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.gap8,
    borderTopWidth: 1,
    borderTopColor: colors.brand.border,
    gap: spacing.gap12,
  },
  tripRouteIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brand.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tripRowMid: { flex: 1 },
  tripRoute: { fontSize: fontSizes.caption, fontWeight: '600', color: colors.brand.textPrimary },
  tripMeta: { fontSize: fontSizes.small, color: colors.brand.textSecondary, marginTop: 2 },
  tripBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  tripBadgeSafe: { backgroundColor: colors.brand.light },
  tripBadgeSOS: { backgroundColor: '#FDEDEC' },
  tripBadgeText: { fontSize: fontSizes.small, fontWeight: '700' },
  tripBadgeTextSafe: { color: colors.brand.primary },
  tripBadgeTextSOS: { color: colors.brand.sos },

  // Contact rows
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.gap8,
    borderTopWidth: 1,
    borderTopColor: colors.brand.border,
    gap: spacing.gap12,
  },
  contactAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brand.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactAvatarText: { color: colors.brand.primary, fontSize: fontSizes.caption, fontWeight: '700' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: fontSizes.caption, fontWeight: '600', color: colors.brand.textPrimary },
  contactSub: { fontSize: fontSizes.small, color: colors.brand.textSecondary, marginTop: 2 },
  addContactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gap8,
    marginTop: spacing.gap12,
    paddingTop: spacing.gap12,
    borderTopWidth: 1,
    borderTopColor: colors.brand.border,
  },
  addContactText: { color: colors.brand.primary, fontSize: fontSizes.caption, fontWeight: '600' },

  // Tab bar (idle + active)
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.brand.bgCard,
    borderTopWidth: 1,
    borderTopColor: colors.brand.border,
    paddingBottom: spacing.gap8,
    paddingTop: spacing.gap8,
  },
  atTabBar: {
    flexDirection: 'row',
    backgroundColor: colors.brand.bgCard,
    borderTopWidth: 1,
    borderTopColor: colors.brand.border,
    paddingTop: spacing.gap8,
  },

  // Shared tab items
  tabItem: { flex: 1, alignItems: 'center', gap: 3 },
  tabActiveLine: {
    width: 20,
    height: 2,
    backgroundColor: colors.brand.primary,
    borderRadius: 2,
    marginTop: -2,
  },
  tabActiveLineDark: {
    backgroundColor: colors.brand.mid,
  },
  tabLabel: { fontSize: fontSizes.small, color: colors.brand.textSecondary },
  tabLabelActive: { color: colors.brand.primary, fontWeight: '600' },
  tabLabelActiveDark: { color: colors.brand.mid, fontWeight: '600' },
  tabLabelInactiveDark: { color: 'rgba(255,255,255,0.35)' },
});

// ── Active trip styles (separate StyleSheet for clarity) ─────────────────────

const atStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F4F3EF',
  },

  // Dark green banner (normal state)
  banner: {
    backgroundColor: '#1A6B4A',
    paddingHorizontal: 16,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bannerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4ADE80',
  },
  bannerTxt: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },
  bannerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerTimer: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '500',
  },
  bgChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  bgChipTxt: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500',
  },

  // Red banner (SOS state)
  sosBanner: {
    backgroundColor: '#C0392B',
    paddingHorizontal: 16,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  sosBannerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    flexShrink: 0,
  },
  sosBannerTxt: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
  },
  sosBannerTime: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
  },

  // Route header
  routeHdr: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 17,
    paddingTop: 11,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEECE6',
  },
  routeText: {
    fontSize: 19,
    fontWeight: '800',
    color: '#1A1A1A',
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  routeMeta: {
    fontSize: 11,
    color: '#9C9A92',
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 13,
    paddingTop: 11,
    gap: 9,
  },

  // Stat row
  statRow: {
    flexDirection: 'row',
    gap: 7,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#EEECE6',
  },
  statVal: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1A1A1A',
    letterSpacing: -0.5,
  },
  statKey: {
    fontSize: 10,
    color: '#9C9A92',
    marginTop: 2,
  },

  // Card (reused for location, standby, alert details, notified)
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 0.5,
    borderColor: '#EEECE6',
  },
  cardLbl: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9C9A92',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 9,
  },

  // Location card
  locRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F4F3EF',
  },
  locRowLast: { borderBottomWidth: 0 },
  locKey: { fontSize: 11, color: '#9C9A92' },
  locVal: { fontSize: 11, color: '#1A1A1A', fontWeight: '500' },
  locWait: {
    fontSize: 13,
    color: '#B4B2A9',
    fontStyle: 'italic',
    marginBottom: 5,
  },
  locNote: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  locNoteTxt: { fontSize: 11, color: '#B4B2A9' },

  // Alert details (SOS sent state)
  alertRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F4F3EF',
  },
  alertRowLast: { borderBottomWidth: 0 },
  alertKey: { fontSize: 11, color: '#9C9A92' },
  alertVal: { fontSize: 11, fontWeight: '600', color: '#1A1A1A' },
  alertValGreen: { color: '#1D9E75' },

  // Notified row
  nrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F4F3EF',
  },
  nrRowLast: { borderBottomWidth: 0 },
  nrName: { fontSize: 12, fontWeight: '500', color: '#1A1A1A', flex: 1 },
  nrBadge: {
    backgroundColor: '#EFF9F4',
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderWidth: 0.5,
    borderColor: '#B8E8D0',
  },
  nrBadgeTxt: { fontSize: 10, color: '#0F6E56', fontWeight: '600' },

  // Circle standby card
  sbTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sbLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sbDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#1D9E75' },
  sbTitle: { fontSize: 13, fontWeight: '600', color: '#1A1A1A' },
  sbPill: {
    backgroundColor: '#EFF9F4',
    borderRadius: 20,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderWidth: 0.5,
    borderColor: '#B8E8D0',
  },
  sbPillTxt: { fontSize: 10, color: '#0F6E56', fontWeight: '600' },
  emptyCircleTxt: { fontSize: fontSizes.caption, color: colors.brand.primary, fontWeight: '600' },

  // Contact item rows
  ciRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F4F3EF',
  },
  ciRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  ciAv: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  ciAvTxt: { fontSize: 9, fontWeight: '700' },
  ciInfo: { flex: 1 },
  ciName: { fontSize: 12, fontWeight: '600', color: '#1A1A1A' },
  ciRel: { fontSize: 10, color: '#9C9A92' },
  ciStatus: { fontSize: 10, color: '#1D9E75', fontWeight: '500' },

  // Overflow stacked avatars
  overflowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 7,
    borderTopWidth: 0.5,
    borderTopColor: '#F4F3EF',
    marginTop: 2,
  },
  stackedAvatars: { flexDirection: 'row' },
  stackedAv: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    marginRight: -5,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  stackedAvTxt: { fontSize: 8, fontWeight: '700' },
  moreLbl: { fontSize: 11, color: '#9C9A92', marginLeft: 12 },
  moreLblBold: { color: '#1A6B4A', fontWeight: '600' },

  // SOS button
  sosBtn: {
    backgroundColor: '#C0392B',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  sosIconCircle: {
    width: 38,
    height: 38,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  sosTextBlock: { flex: 1 },
  sosTitle: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  sosSub: { fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 2 },

  // Cancel SOS button
  cancelBtn: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#F7C1C1',
  },
  cancelTxt: { fontSize: 12, color: '#A32D2D', fontWeight: '600' },

  // End trip button
  endBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#EEECE6',
  },
  endTxt: { fontSize: 12, color: '#9C9A92', fontWeight: '500' },
});

export default HomeScreen;

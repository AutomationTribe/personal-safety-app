import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { startTracking, stopTracking, getLastPing, LocationPing } from '../../services/LocationService';
import { triggerSOS } from '../../services/SOSService';
import { colors, fontSizes, spacing } from '../../styles/tokens';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Trip {
  id: string;
  title: string | null;
  origin: string | null;
  destination: string | null;
  status: 'active' | 'completed' | 'sos';
  started_at: string | null;
  ended_at: string | null;
  expected_duration_minutes: number | null;
  created_at: string;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
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

function elapsedLabel(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function coordLabel(lat: number, lng: number): string {
  return `${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E`;
}

// ── HomeScreen ────────────────────────────────────────────────────────────────

const SOS_HOLD_MS = 3000;

const HomeScreen = () => {
  const { isOnline } = useNetworkStatus();

  const [userName, setUserName] = useState('');
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [recentTrips, setRecentTrips] = useState<Trip[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [lastPing, setLastPing] = useState<LocationPing | null>(null);
  const [pingCount, setPingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // SOS hold animation
  const sosProgress = useRef(new Animated.Value(0)).current;
  const sosAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const [sosHolding, setSosHolding] = useState(false);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const [{ data: { user } }, activeTripRes, recentRes, contactsRes] = await Promise.all([
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
      ]);

      const meta = user?.user_metadata as { full_name?: string } | undefined;
      setUserName(meta?.full_name ?? user?.email ?? '');
      setActiveTrip((activeTripRes.data as Trip | null) ?? null);
      setRecentTrips((recentRes.data as Trip[]) ?? []);
      setContacts((contactsRes.data as Contact[]) ?? []);

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

  // Realtime: watch trips table for status changes
  useEffect(() => {
    const channel = supabase
      .channel('home-trips')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => {
        loadData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  // Elapsed time ticker while trip is active
  useEffect(() => {
    if (!activeTrip) return;
    const timer = setInterval(() => {
      if (activeTrip.started_at) {
        const ms = Date.now() - new Date(activeTrip.started_at).getTime();
        setPingCount((c) => c); // trigger re-render for elapsed label
        void ms;
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, [activeTrip]);

  // ── Trip actions ────────────────────────────────────────────────────────────

  const handleStartTrip = async () => {
    try {
      const { data, error } = await supabase
        .from('trips')
        .insert({ status: 'active', started_at: new Date().toISOString() })
        .select()
        .single();

      if (error || !data) throw new Error(error?.message ?? 'Failed to create trip');
      const trip = data as Trip;
      setActiveTrip(trip);
      await startTracking(trip.id, 30);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not start trip');
    }
  };

  const handleEndTrip = async () => {
    if (!activeTrip) return;
    Alert.alert(
      'End trip',
      'Mark this journey as completed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End trip',
          onPress: async () => {
            try {
              await supabase
                .from('trips')
                .update({ status: 'completed', ended_at: new Date().toISOString() })
                .eq('id', activeTrip.id);
              await stopTracking();
              setActiveTrip(null);
              await loadData();
            } catch {
              Alert.alert('Error', 'Could not end trip');
            }
          },
        },
      ]
    );
  };

  // ── SOS hold ─────────────────────────────────────────────────────────────────

  const handleSOSPressIn = () => {
    if (!activeTrip) return;
    setSosHolding(true);
    sosAnimation.current = Animated.timing(sosProgress, {
      toValue: 1,
      duration: SOS_HOLD_MS,
      useNativeDriver: false,
    });
    sosAnimation.current.start(({ finished }) => {
      if (finished) handleSOSFire();
    });
  };

  const handleSOSPressOut = () => {
    sosAnimation.current?.stop();
    sosProgress.setValue(0);
    setSosHolding(false);
  };

  const handleSOSFire = async () => {
    sosProgress.setValue(0);
    setSosHolding(false);
    if (!activeTrip) return;

    try {
      const result = await triggerSOS(activeTrip.id);
      if (result.success) {
        Alert.alert(
          'SOS sent',
          result.method === 'sms'
            ? 'SMS fallback sent to your circle.'
            : result.method === 'both'
            ? 'Alert sent via internet + SMS.'
            : 'Alert sent to your circle.',
        );
      } else {
        Alert.alert('SOS failed', result.error ?? 'Could not reach your circle.');
      }
    } catch {
      Alert.alert('SOS error', 'An unexpected error occurred.');
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
    return <ActiveTripView
      trip={activeTrip}
      contacts={contacts}
      lastPing={lastPing}
      pingCount={pingCount}
      sosProgress={sosProgress}
      sosHolding={sosHolding}
      onSOSPressIn={handleSOSPressIn}
      onSOSPressOut={handleSOSPressOut}
      onEndTrip={handleEndTrip}
    />;
  }

  return <IdleView
    userName={userName}
    isOnline={isOnline}
    recentTrips={recentTrips}
    contacts={contacts}
    onStartTrip={handleStartTrip}
  />;
};

// ── Idle state ─────────────────────────────────────────────────────────────────

interface IdleViewProps {
  userName: string;
  isOnline: boolean;
  recentTrips: Trip[];
  contacts: Contact[];
  onStartTrip: () => void;
}

const IdleView = ({ userName, isOnline, recentTrips, contacts, onStartTrip }: IdleViewProps) => (
  <SafeAreaView style={styles.idleRoot}>
    {/* Header */}
    <View style={styles.idleHeader}>
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
        <Pressable style={({ pressed }) => [styles.heroCta, pressed && styles.heroCtaPressed]} onPress={onStartTrip}>
          <Text style={styles.heroCtaText}>Start a trip  →</Text>
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
        <View style={styles.addContactRow}>
          <Feather name="plus-circle" size={16} color={colors.brand.primary} />
          <Text style={styles.addContactText}>Add a trusted contact</Text>
        </View>
      </View>
    </ScrollView>

    {/* Bottom tab bar */}
    <View style={styles.tabBar}>
      <TabBarItem icon="home" label="Home" active />
      <TabBarItem icon="map" label="Routes" />
      <TabBarItem icon="users" label="Circle" />
      <TabBarItem icon="settings" label="Settings" />
    </View>
  </SafeAreaView>
);

// ── Active trip state ─────────────────────────────────────────────────────────

interface ActiveTripViewProps {
  trip: Trip;
  contacts: Contact[];
  lastPing: LocationPing | null;
  pingCount: number;
  sosProgress: Animated.Value;
  sosHolding: boolean;
  onSOSPressIn: () => void;
  onSOSPressOut: () => void;
  onEndTrip: () => void;
}

const ActiveTripView = ({
  trip,
  contacts,
  lastPing,
  pingCount,
  sosProgress,
  sosHolding,
  onSOSPressIn,
  onSOSPressOut,
  onEndTrip,
}: ActiveTripViewProps) => {
  const sosBarWidth = sosProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const contactNames = contacts.map((c) => firstName(c.name));
  const circleLabel = contactNames.length >= 2
    ? `${contactNames[0]} and ${contactNames[1]} can see you right now.`
    : contactNames.length === 1
    ? `${contactNames[0]} can see you right now.`
    : 'Your circle can see you right now.';

  return (
    <SafeAreaView style={styles.activeRoot}>
      {/* Header */}
      <View style={styles.activeHeader}>
        <Text style={styles.activeEyebrow}>TRIP IN PROGRESS</Text>
        <Text style={styles.activeTitle} numberOfLines={1}>
          {trip.origin ?? 'Origin'}  →  {trip.destination ?? 'Destination'}
        </Text>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.livePillText}>Your circle can see you · Live</Text>
        </View>
      </View>

      <ScrollView style={styles.activeScroll} contentContainerStyle={styles.activeScrollContent} showsVerticalScrollIndicator={false}>
        {/* Stats card */}
        <View style={styles.darkCard}>
          <Text style={styles.darkCardTitle}>Journey stats</Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{trip.started_at ? elapsedLabel(trip.started_at) : '—'}</Text>
              <Text style={styles.statLabel}>Elapsed</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{pingCount}</Text>
              <Text style={styles.statLabel}>Pings sent</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>—</Text>
              <Text style={styles.statLabel}>km covered</Text>
            </View>
          </View>
        </View>

        {/* Last location card */}
        <View style={styles.darkCard}>
          <Text style={styles.darkCardTitle}>Last known location</Text>
          {lastPing ? (
            <>
              <Text style={styles.locationCoords}>{coordLabel(lastPing.lat, lastPing.lng)}</Text>
              <Text style={styles.locationTime}>
                Updated {formatDate(lastPing.timestamp)}
              </Text>
            </>
          ) : (
            <Text style={styles.locationTime}>Waiting for first ping…</Text>
          )}
          <Text style={styles.circleLabel}><Text style={styles.circleLabelItalic}>{circleLabel}</Text></Text>
        </View>

        {/* SOS button */}
        <Pressable
          style={({ pressed }) => [styles.sosButton, (pressed || sosHolding) && styles.sosButtonActive]}
          onPressIn={onSOSPressIn}
          onPressOut={onSOSPressOut}
          delayLongPress={SOS_HOLD_MS}
        >
          <View style={styles.sosInner}>
            <Feather name="alert-triangle" size={22} color={colors.white} />
            <View style={styles.sosMid}>
              <Text style={styles.sosLabel}>Send SOS alert</Text>
              <Text style={styles.sosSubLabel}>Alerts your circle + SMS fallback</Text>
            </View>
            <Text style={styles.sosHoldHint}>Hold{'\n'}3 sec</Text>
          </View>
        </Pressable>

        {/* Hold progress bar */}
        <View style={styles.sosProgressTrack}>
          <Animated.View style={[styles.sosProgressBar, { width: sosBarWidth }]} />
        </View>
        {sosHolding && (
          <Text style={styles.sosHoldHintBar}>Hold the SOS button for 3 seconds</Text>
        )}

        {/* End trip */}
        <Pressable style={({ pressed }) => [styles.endTripButton, pressed && styles.endTripButtonPressed]} onPress={onEndTrip}>
          <Text style={styles.endTripText}>I've arrived safely — end trip</Text>
        </Pressable>
      </ScrollView>

      {/* Dark bottom tab bar */}
      <View style={styles.darkTabBar}>
        <TabBarItem icon="home" label="Home" active dark />
        <TabBarItem icon="map" label="Routes" dark />
        <TabBarItem icon="users" label="Circle" dark />
        <TabBarItem icon="settings" label="Settings" dark />
      </View>
    </SafeAreaView>
  );
};

// ── Tab bar item ──────────────────────────────────────────────────────────────

interface TabBarItemProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  active?: boolean;
  dark?: boolean;
}

const TabBarItem = ({ icon, label, active = false, dark = false }: TabBarItemProps) => (
  <View style={styles.tabItem}>
    <Feather
      name={icon}
      size={22}
      color={
        active
          ? dark ? colors.brand.mid : colors.brand.primary
          : dark ? 'rgba(255,255,255,0.35)' : colors.brand.textSecondary
      }
    />
    <Text style={[
      styles.tabLabel,
      active && (dark ? styles.tabLabelActiveDark : styles.tabLabelActive),
      !active && dark && styles.tabLabelInactiveDark,
    ]}>
      {label}
    </Text>
  </View>
);

// ── Styles ─────────────────────────────────────────────────────────────────────

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
    paddingTop: spacing.gap16,
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

  // Tab bar (idle)
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.brand.bgCard,
    borderTopWidth: 1,
    borderTopColor: colors.brand.border,
    paddingBottom: spacing.gap8,
    paddingTop: spacing.gap8,
  },

  // ── Active trip ───────────────────────────────────────────────────────────
  activeRoot: { flex: 1, backgroundColor: colors.brand.darkBase },
  activeHeader: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.gap16,
    paddingBottom: spacing.gap16,
    backgroundColor: colors.brand.darkBase,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  activeEyebrow: {
    fontSize: fontSizes.small,
    fontWeight: '700',
    color: colors.brand.mid,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  activeTitle: {
    fontSize: fontSizes.subheading,
    fontWeight: '700',
    color: colors.white,
    marginBottom: spacing.gap8,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(29,158,117,0.15)',
    paddingHorizontal: spacing.gap8,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brand.mid,
  },
  livePillText: { fontSize: fontSizes.small, color: colors.brand.mid, fontWeight: '600' },

  activeScroll: { flex: 1 },
  activeScrollContent: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.gap16,
    paddingBottom: 120,
    gap: spacing.gap12,
  },

  // Dark cards
  darkCard: {
    backgroundColor: colors.brand.darkCard,
    borderRadius: spacing.borderRadiusLg,
    padding: spacing.gap16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  darkCardTitle: {
    fontSize: fontSizes.small,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.gap12,
  },

  // Stats
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: fontSizes.subheading, fontWeight: '700', color: colors.white },
  statLabel: { fontSize: fontSizes.small, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.1)' },

  // Last location
  locationCoords: { fontSize: fontSizes.body, fontWeight: '600', color: colors.white, marginBottom: 4 },
  locationTime: { fontSize: fontSizes.caption, color: 'rgba(255,255,255,0.45)', marginBottom: spacing.gap8 },
  circleLabel: { marginTop: spacing.gap8 },
  circleLabelItalic: {
    fontSize: fontSizes.caption,
    color: colors.brand.mid,
    fontStyle: 'italic',
  },

  // SOS
  sosButton: {
    backgroundColor: colors.brand.sos,
    borderRadius: spacing.borderRadiusLg,
    padding: spacing.gap16,
  },
  sosButtonActive: { opacity: 0.85 },
  sosInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.gap12 },
  sosMid: { flex: 1 },
  sosLabel: { color: colors.white, fontSize: fontSizes.body, fontWeight: '700' },
  sosSubLabel: { color: 'rgba(255,255,255,0.7)', fontSize: fontSizes.small, marginTop: 2 },
  sosHoldHint: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: fontSizes.small,
    fontWeight: '600',
    textAlign: 'center',
  },
  sosProgressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  sosProgressBar: {
    height: '100%',
    backgroundColor: colors.brand.sos,
    borderRadius: 2,
  },
  sosHoldHintBar: {
    textAlign: 'center',
    fontSize: fontSizes.small,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 4,
  },

  // End trip
  endTripButton: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: spacing.borderRadiusLg,
    paddingVertical: spacing.gap16,
    alignItems: 'center',
  },
  endTripButtonPressed: { opacity: 0.7 },
  endTripText: { color: 'rgba(255,255,255,0.7)', fontSize: fontSizes.body, fontWeight: '500' },

  // Dark tab bar
  darkTabBar: {
    flexDirection: 'row',
    backgroundColor: colors.brand.darkNav,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    paddingBottom: spacing.gap8,
    paddingTop: spacing.gap8,
  },

  // Shared tab items
  tabItem: { flex: 1, alignItems: 'center', gap: 3 },
  tabLabel: { fontSize: fontSizes.small, color: colors.brand.textSecondary },
  tabLabelActive: { color: colors.brand.primary, fontWeight: '600' },
  tabLabelActiveDark: { color: colors.brand.mid, fontWeight: '600' },
  tabLabelInactiveDark: { color: 'rgba(255,255,255,0.35)' },
});

export default HomeScreen;

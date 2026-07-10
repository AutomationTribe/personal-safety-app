import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { AppStackParamList } from '../../navigation/AppNavigator';
import { supabase } from '../../lib/supabase';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { Trip } from '../trip/StartTripModal';
import { SOSEvent } from './RoutesScreen';

// ── Types ─────────────────────────────────────────────────────────────────────

type TripDetailRoute = RouteProp<AppStackParamList, 'TripDetail'>;

interface Ping {
  id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  created_at: string;
}

interface SOSMarker {
  id: string;
  lat: number | null;
  lng: number | null;
  triggered_at: string;
  delivery_method: SOSEvent['delivery_method'];
  resolved_at: string | null;
  cancelled_at: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt || !endedAt) return '—';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms <= 0) return '—';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}min`;
  return `${h}h ${String(m).padStart(2, '0')}min`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function totalDistanceKm(pings: Ping[]): number {
  let total = 0;
  for (let i = 1; i < pings.length; i++) {
    total += haversineKm(pings[i - 1], pings[i]);
  }
  return total;
}

// ── Component ─────────────────────────────────────────────────────────────────

const TripDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<TripDetailRoute>();
  const { tripId } = route.params;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [pings, setPings] = useState<Ping[]>([]);
  const [sosEvents, setSosEvents] = useState<SOSMarker[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: tripData }, { data: pingRows }, { data: sosRows }] = await Promise.all([
      supabase.from('trips').select('*').eq('id', tripId).single(),
      supabase.rpc('get_trip_location_pings', { p_trip_id: tripId }),
      supabase.rpc('get_trip_sos_events', { p_trip_id: tripId }),
    ]);

    setTrip((tripData as Trip) ?? null);
    setPings((pingRows as Ping[]) ?? []);
    setSosEvents((sosRows as SOSMarker[]) ?? []);
    setLoading(false);
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={[styles.root, styles.centerWrap, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.brand.primary} size="large" />
      </View>
    );
  }

  if (!trip) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color={colors.brand.primary} />
          <Text style={styles.backText}>Back to routes</Text>
        </Pressable>
        <View style={styles.centerWrap}>
          <Text style={styles.sub}>Trip not found.</Text>
        </View>
      </View>
    );
  }

  const isSOS = trip.status === 'sos';
  const isActive = trip.status === 'active';
  const duration = formatDuration(trip.started_at, trip.ended_at);
  const distanceKm = totalDistanceKm(pings);
  const badgeLabel = isSOS ? 'SOS fired' : isActive ? 'Active' : 'Safe';

  const region = pings.length > 0
    ? { latitude: pings[0].lat, longitude: pings[0].lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Pressable style={styles.back} onPress={() => navigation.goBack()}>
        <Feather name="arrow-left" size={20} color={colors.brand.primary} />
        <Text style={styles.backText}>Back to routes</Text>
      </Pressable>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* ── Header ── */}
        <View style={styles.headerCard}>
          <Text style={styles.route}>{trip.origin ?? '—'}  →  {trip.destination ?? '—'}</Text>
          <View style={[styles.badge, isSOS ? styles.badgeSOS : styles.badgeSafe]}>
            <Text style={[styles.badgeText, isSOS ? styles.badgeSOSText : styles.badgeSafeText]}>{badgeLabel}</Text>
          </View>
        </View>

        {/* ── Metadata ── */}
        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Started</Text>
            <Text style={styles.metaValue}>{formatDateTime(trip.started_at)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Ended</Text>
            <Text style={styles.metaValue}>{formatDateTime(trip.ended_at)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Duration</Text>
            <Text style={styles.metaValue}>{duration}</Text>
          </View>
          <View style={[styles.metaRow, styles.metaRowLast]}>
            <Text style={styles.metaLabel}>Distance</Text>
            <Text style={styles.metaValue}>{distanceKm > 0 ? `${distanceKm.toFixed(1)} km` : '—'}</Text>
          </View>
        </View>

        {/* ── Map ── */}
        <View style={styles.mapWrap}>
          {region ? (
            <MapView style={styles.map} initialRegion={region}>
              <Polyline
                coordinates={pings.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
                strokeColor={colors.brand.primary}
                strokeWidth={3}
              />
              {pings.length > 0 && (
                <Marker
                  coordinate={{ latitude: pings[0].lat, longitude: pings[0].lng }}
                  pinColor={colors.brand.primary}
                  title="Start"
                />
              )}
              {pings.length > 1 && (
                <Marker
                  coordinate={{ latitude: pings[pings.length - 1].lat, longitude: pings[pings.length - 1].lng }}
                  pinColor={colors.brand.mid}
                  title="Latest"
                />
              )}
              {sosEvents
                .filter((s) => s.lat !== null && s.lng !== null)
                .map((s) => (
                  <Marker
                    key={s.id}
                    coordinate={{ latitude: s.lat as number, longitude: s.lng as number }}
                    pinColor={colors.brand.sos}
                    title="SOS triggered"
                  />
                ))}
            </MapView>
          ) : (
            <View style={styles.mapEmpty}>
              <Feather name="map" size={22} color={colors.brand.textSecondary} />
              <Text style={styles.mapEmptyText}>No location pings yet.</Text>
            </View>
          )}
        </View>

        {/* ── SOS events ── */}
        {sosEvents.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SOS events on this trip</Text>
            {sosEvents.map((s) => {
              const status = s.cancelled_at ? 'Cancelled' : s.resolved_at ? 'Resolved' : 'Active';
              return (
                <View key={s.id} style={styles.sosRow}>
                  <View style={styles.sosIcon}>
                    <Feather name="alert-triangle" size={14} color={colors.brand.sos} />
                  </View>
                  <View style={styles.sosInfo}>
                    <Text style={styles.sosTitle}>Emergency SOS triggered</Text>
                    <Text style={styles.sosMeta}>{formatDateTime(s.triggered_at)}</Text>
                  </View>
                  <Text style={styles.sosStatus}>{status}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Ping list ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location pings ({pings.length})</Text>
          {pings.length === 0 ? (
            <Text style={styles.sub}>No location pings yet.</Text>
          ) : (
            [...pings].reverse().map((p) => (
              <View key={p.id} style={styles.pingRow}>
                <Text style={styles.pingTime}>{formatDateTime(p.created_at)}</Text>
                <Text style={styles.pingCoords}>{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
};

export default TripDetailScreen;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.brand.bgSurface,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: spacing.screenPadding,
  },
  backText: {
    fontSize: fontSizes.body,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.gap32,
    gap: spacing.gap16,
  },

  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.gap12,
  },
  route: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    color: colors.brand.textPrimary,
  },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 0.5,
  },
  badgeSafe: { backgroundColor: colors.brand.light, borderColor: colors.brand.border },
  badgeSafeText: { color: '#0F6E56' },
  badgeSOS: { backgroundColor: '#FDEDEC', borderColor: '#F9C6C6' },
  badgeSOSText: { color: '#A32D2D' },
  badgeText: { fontSize: 11, fontWeight: '700' },

  metaCard: {
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: '#EEECe6',
    padding: spacing.gap16,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F0EFEA',
  },
  metaRowLast: { borderBottomWidth: 0 },
  metaLabel: { fontSize: fontSizes.caption, color: colors.brand.textSecondary },
  metaValue: { fontSize: fontSizes.caption, fontWeight: '700', color: colors.brand.textPrimary },

  mapWrap: {
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: '#EEECe6',
  },
  map: { flex: 1 },
  mapEmpty: {
    flex: 1,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  mapEmptyText: { fontSize: fontSizes.caption, color: colors.brand.textSecondary },

  section: { gap: spacing.gap8 },
  sectionTitle: {
    fontSize: fontSizes.caption,
    fontWeight: '700',
    color: colors.brand.textSecondary,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },

  sosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#F9C6C6',
    padding: spacing.gap12,
  },
  sosIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#FDEDEC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sosInfo: { flex: 1 },
  sosTitle: { fontSize: 13, fontWeight: '700', color: colors.brand.textPrimary },
  sosMeta: { fontSize: 11, color: colors.brand.textSecondary, marginTop: 2 },
  sosStatus: { fontSize: 11, fontWeight: '700', color: colors.brand.sos },

  pingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEECe6',
  },
  pingTime: { fontSize: 12, color: colors.brand.textPrimary },
  pingCoords: { fontSize: 12, color: colors.brand.textSecondary },

  sub: {
    fontSize: 14,
    color: colors.brand.textSecondary,
  },
});

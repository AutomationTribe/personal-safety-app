import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MapView from 'react-native-maps';
import { AppStackParamList } from '../../navigation/AppNavigator';
import { supabase } from '../../lib/supabase';
import { colors, spacing } from '../../styles/tokens';
import { Trip } from '../trip/StartTripModal';
import SuccessToast from '../../components/SuccessToast';

// ── Local palette (History-specific accents — not part of the shared brand tokens) ──

const H = {
  navy: '#241E46',
  purple: '#4B0082',
  purpleLight: '#EDE9FE',
  blue: '#3B6FE0',
  blueLight: '#E8F0FE',
  cyanText: '#0E7C86',
  cyanLight: '#E3F6F8',
  greenText: '#0F6E56',
  greenLight: '#EFF9F4',
  red: '#C0392B',
  redLight: '#FDEDEC',
  ink: '#1A1A1A',
  sub: '#8B8A93',
  hairline: '#EEECe6',
};

// ── Types ─────────────────────────────────────────────────────────────────────

type Filter = 'all' | 'trips' | 'sos';

export interface SOSEvent {
  id: string;
  trip_id: string | null;
  user_id: string;
  triggered_at: string;
  delivery_method: 'internet' | 'sms' | 'both';
  resolved_at: string | null;
  resolved_by: string | null;
  notes: string | null;
  cancelled_at: string | null;
  contacts_total: number;
  contacts_notified: number;
  created_at: string;
  alert_level: 1 | 2;
  trigger_type: 'manual' | 'accident' | 'trip_auto';
  notified_contact_ids: string[];
  battery_level: number | null;
  network_type: string | null;
}

const TRIGGER_TYPE_LABEL: Record<SOSEvent['trigger_type'], string> = {
  manual: 'Manual',
  accident: 'Accident',
  trip_auto: 'Trip auto-SOS',
};

type HistoryItem =
  | { kind: 'trip'; id: string; date: string; trip: Trip }
  | { kind: 'sos'; id: string; date: string; sos: SOSEvent };

interface OpenSwipe {
  id: string;
  value: Animated.Value;
}

type Nav = NativeStackNavigationProp<AppStackParamList>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt || !endedAt) return '';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms <= 0) return '';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} minutes`;
  return `${h}h ${String(m).padStart(2, '0')}min`;
}

function formatTripDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  ) {
    return 'Today';
  }
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateTimeShort(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  const timePart = d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${datePart}, ${timePart}`;
}

function weekdayName(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', { weekday: 'long' });
}

// ── Bottom nav bar ────────────────────────────────────────────────────────────

interface NavItemProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  active?: boolean;
  onPress?: () => void;
}

const NavItem = ({ icon, label, active = false, onPress }: NavItemProps) => (
  <Pressable style={rs.navItem} onPress={onPress}>
    <Feather name={icon} size={22} color={active ? H.purple : '#9C9A92'} />
    {active && <View style={rs.navActiveBar} />}
    <Text style={[rs.navLabel, active && rs.navLabelActive]}>{label}</Text>
  </Pressable>
);

// ── Trip row ──────────────────────────────────────────────────────────────────

const SWIPE_ACTION_WIDTH = 124; // 62px × 2
const SWIPE_THRESHOLD = 80;

interface TripRowProps {
  trip: Trip;
  selectMode: boolean;
  selected: boolean;
  openSwipeRef: React.MutableRefObject<OpenSwipe | null>;
  onToggleSelect: (id: string) => void;
  onEnterSelectMode: (id: string) => void;
  onView: (id: string) => void;
  onDeleteRequest: (trip: Trip) => void;
}

const TripRow = React.memo(
  ({ trip, selectMode, selected, openSwipeRef, onToggleSelect, onEnterSelectMode, onView, onDeleteRequest }: TripRowProps) => {
    const translateX = useRef(new Animated.Value(0)).current;

    const closeSwipe = useCallback(() => {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 100, friction: 10 }).start();
      if (openSwipeRef.current?.id === trip.id) openSwipeRef.current = null;
    }, [translateX, openSwipeRef, trip.id]);

    const panResponder = useRef(
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderGrant: () => {
          if (openSwipeRef.current && openSwipeRef.current.id !== trip.id) {
            Animated.spring(openSwipeRef.current.value, {
              toValue: 0, useNativeDriver: true, tension: 100, friction: 10,
            }).start();
          }
          openSwipeRef.current = { id: trip.id, value: translateX };
        },
        onPanResponderMove: (_, g) => {
          translateX.setValue(Math.min(0, Math.max(-SWIPE_ACTION_WIDTH, g.dx)));
        },
        onPanResponderRelease: (_, g) => {
          if (g.dx < -SWIPE_THRESHOLD) {
            Animated.spring(translateX, {
              toValue: -SWIPE_ACTION_WIDTH, useNativeDriver: true, tension: 100, friction: 10,
            }).start();
          } else {
            Animated.spring(translateX, {
              toValue: 0, useNativeDriver: true, tension: 100, friction: 10,
            }).start();
            if (openSwipeRef.current?.id === trip.id) openSwipeRef.current = null;
          }
        },
      })
    ).current;

    const handlePress = () => {
      if (openSwipeRef.current?.id === trip.id) { closeSwipe(); return; }
      if (selectMode) onToggleSelect(trip.id);
      else onView(trip.id);
    };

    const isSOS = trip.status === 'sos';
    const isActive = trip.status === 'active';
    const isCompleted = trip.status === 'completed';
    const duration = formatDuration(trip.started_at, trip.ended_at);
    const timeStr = formatTime(trip.started_at ?? trip.created_at);
    const destLabel = trip.destination ?? trip.title ?? 'Unknown destination';

    const metaLine = isActive
      ? 'In progress'
      : duration
        ? `${duration} duration`
        : formatTripDate(trip.created_at);

    return (
      <View style={rs.rowOuter}>
        {/* Action buttons revealed on swipe-left */}
        <View style={rs.swipeActions}>
          <Pressable style={rs.actionView} onPress={() => { closeSwipe(); onView(trip.id); }}>
            <Feather name="eye" size={18} color="#fff" />
            <Text style={rs.actionLabel}>View</Text>
          </Pressable>
          <Pressable style={rs.actionDelete} onPress={() => { closeSwipe(); onDeleteRequest(trip); }}>
            <Feather name="trash-2" size={18} color="#fff" />
            <Text style={rs.actionLabel}>Delete</Text>
          </Pressable>
        </View>

        {/* Sliding card */}
        <Animated.View
          style={[rs.card, { transform: [{ translateX }] }]}
          {...(selectMode ? {} : panResponder.panHandlers)}
        >
          <Pressable
            style={rs.cardInner}
            onPress={handlePress}
            onLongPress={() => onEnterSelectMode(trip.id)}
          >
            {selectMode && (
              <View style={[rs.checkbox, selected && rs.checkboxChecked]}>
                {selected && <Feather name="check" size={11} color="#fff" />}
              </View>
            )}

            {/* Trip icon */}
            <View style={[rs.tripIcon, isSOS && rs.tripIconSOS]}>
              <Feather
                name={isSOS ? 'alert-triangle' : 'map-pin'}
                size={16}
                color={isSOS ? H.red : H.blue}
              />
            </View>

            {/* Info */}
            <View style={rs.info}>
              <View style={rs.titleRow}>
                <Text style={rs.tripTitle} numberOfLines={1}>Trip to {destLabel}</Text>
                <Text style={rs.timeText}>{timeStr}</Text>
              </View>
              <View style={rs.metaRow}>
                <Feather name="clock" size={11} color={H.sub} />
                <Text style={rs.meta}>{metaLine}</Text>
              </View>
              <View style={rs.badgeRow}>
                {isCompleted && (
                  <View style={[rs.badge, rs.badgeGreen]}>
                    <Text style={[rs.badgeText, rs.badgeGreenText]}>Completed</Text>
                  </View>
                )}
                {isCompleted && (
                  <View style={[rs.badge, rs.badgeCyan]}>
                    <Text style={[rs.badgeText, rs.badgeCyanText]}>Safe Passage</Text>
                  </View>
                )}
                {isActive && (
                  <View style={[rs.badge, rs.badgeBlue]}>
                    <Text style={[rs.badgeText, rs.badgeBlueText]}>Active</Text>
                  </View>
                )}
                {isSOS && (
                  <View style={[rs.badge, rs.badgeRed]}>
                    <Text style={[rs.badgeText, rs.badgeRedText]}>SOS fired</Text>
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        </Animated.View>
      </View>
    );
  }
);

// ── SOS row (read-only) ───────────────────────────────────────────────────────

interface SOSRowProps {
  sos: SOSEvent;
  tripLabel: string | null;
  onPress: (sosId: string) => void;
}

const SOSRow = React.memo(({ sos, tripLabel, onPress }: SOSRowProps) => {
  const status: 'Resolved' | 'Cancelled' | 'Active' = sos.cancelled_at
    ? 'Cancelled'
    : sos.resolved_at
      ? 'Resolved'
      : 'Active';

  return (
    <Pressable style={ss.card} onPress={() => onPress(sos.id)}>
      <View style={ss.cardInner}>
        <View style={ss.icon}>
          <Feather name="alert-triangle" size={16} color={H.red} />
        </View>
        <View style={ss.info}>
          <Text style={ss.title}>{formatDateTimeShort(sos.triggered_at)}</Text>
          <View style={ss.badgeRow}>
            <View style={ss.triggerBadge}>
              <Text style={ss.triggerBadgeText}>{TRIGGER_TYPE_LABEL[sos.trigger_type]}</Text>
            </View>
            <View style={[ss.badge, sos.alert_level === 1 ? ss.badgeLevel1 : ss.badgeLevel2]}>
              <Text style={[ss.badgeText, sos.alert_level === 1 ? ss.badgeLevel1Text : ss.badgeLevel2Text]}>
                {sos.alert_level === 1 ? '1st level' : '2nd level'}
              </Text>
            </View>
            <View
              style={[
                ss.badge,
                status === 'Resolved' ? ss.badgeResolved : status === 'Cancelled' ? ss.badgeCancelled : ss.badgeActive,
              ]}
            >
              {status === 'Active' && <View style={ss.activeDot} />}
              <Text
                style={[
                  ss.badgeText,
                  status === 'Resolved' ? ss.badgeResolvedText : status === 'Cancelled' ? ss.badgeCancelledText : ss.badgeActiveText,
                ]}
              >
                {status}
              </Text>
            </View>
          </View>
          {tripLabel && (
            <View style={ss.locRow}>
              <Feather name="map-pin" size={11} color={H.sub} />
              <Text style={ss.meta} numberOfLines={1}>During trip: {tripLabel}</Text>
            </View>
          )}
        </View>
        <Feather name="chevron-right" size={16} color={H.sub} />
      </View>
    </Pressable>
  );
});

const ss = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 14,
    borderLeftWidth: 3,
    borderLeftColor: H.red,
    borderWidth: 0.5,
    borderColor: H.hairline,
    marginBottom: 9,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: 13,
    gap: 9,
  },
  icon: {
    width: 31,
    height: 31,
    borderRadius: 9,
    backgroundColor: H.redLight,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  info: { flex: 1, gap: 4 },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: H.ink,
  },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: {
    fontSize: 11,
    color: H.sub,
    flexShrink: 1,
  },
  badgeRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  triggerBadge: {
    backgroundColor: '#FEF3E2',
    borderWidth: 0.5,
    borderColor: '#F5DDAA',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  triggerBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#92600C',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 0.5,
  },
  badgeLevel1: { backgroundColor: H.redLight, borderColor: '#F9C6C6' },
  badgeLevel1Text: { color: '#A32D2D' },
  badgeLevel2: { backgroundColor: '#FEF3E2', borderColor: '#F5DDAA' },
  badgeLevel2Text: { color: '#92600C' },
  badgeResolved: { backgroundColor: H.greenLight, borderColor: '#C6E8D5' },
  badgeResolvedText: { color: H.greenText },
  badgeCancelled: { backgroundColor: '#F4F3EF', borderColor: '#E0DED8' },
  badgeCancelledText: { color: '#9C9A92' },
  badgeActive: { backgroundColor: H.redLight, borderColor: '#F9C6C6' },
  badgeActiveText: { color: '#A32D2D' },
  badgeText: { fontSize: 10, fontWeight: '600' },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#BA1A1A' },
});

// ── Delete sheet ──────────────────────────────────────────────────────────────

interface DeleteSheetProps {
  visible: boolean;
  trip: Trip | null;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteSheet = ({ visible, trip, deleting, onConfirm, onCancel }: DeleteSheetProps) => {
  if (!trip) return null;
  const isSOS = trip.status === 'sos';
  const duration = formatDuration(trip.started_at, trip.ended_at);
  const previewMeta = [
    formatTripDate(trip.created_at),
    isSOS ? 'SOS fired' : trip.status === 'active' ? 'Active' : 'Safe',
    duration,
  ].filter(Boolean).join('  ·  ');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <View style={ds.overlay}>
        <Pressable style={ds.dismiss} onPress={onCancel} />
        <View style={ds.sheet}>
          <View style={ds.handleRow}><View style={ds.handle} /></View>

          <View style={ds.iconWrap}>
            <Feather name="trash-2" size={24} color="#C0392B" />
          </View>

          <Text style={ds.title}>Delete this trip?</Text>
          <Text style={ds.body}>
            This will permanently remove the trip record and all location pings. This cannot be undone.
          </Text>

          <View style={ds.previewCard}>
            <View style={[ds.previewIcon, isSOS && ds.previewIconSOS]}>
              <Feather name={isSOS ? 'alert-triangle' : 'navigation'} size={14} color={isSOS ? '#C0392B' : '#1A6B4A'} />
            </View>
            <View style={ds.previewInfo}>
              <Text style={ds.previewRoute} numberOfLines={1}>
                {trip.origin ?? '—'}  →  {trip.destination ?? '—'}
              </Text>
              <Text style={ds.previewMeta}>{previewMeta}</Text>
            </View>
          </View>

          <View style={ds.btns}>
            <Pressable
              style={({ pressed }) => [ds.btn, ds.btnKeep, pressed && { opacity: 0.7 }]}
              onPress={onCancel}
              disabled={deleting}
            >
              <Text style={ds.btnKeepText}>Keep it</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [ds.btn, ds.btnDelete, (deleting || pressed) && { opacity: 0.8 }]}
              onPress={onConfirm}
              disabled={deleting}
            >
              {deleting
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={ds.btnDeleteText}>Delete</Text>
              }
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ── Bulk Delete Sheet ─────────────────────────────────────────────────────────

interface BulkDeleteSheetProps {
  visible: boolean;
  count: number;
  hasActive: boolean;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const BulkDeleteSheet = ({ visible, count, hasActive, deleting, onConfirm, onCancel }: BulkDeleteSheetProps) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
    <View style={ds.overlay}>
      <Pressable style={ds.dismiss} onPress={onCancel} />
      <View style={ds.sheet}>
        <View style={ds.handleRow}><View style={ds.handle} /></View>

        <View style={[ds.iconWrap, hasActive && { backgroundColor: '#FFF3E0' }]}>
          <Feather
            name={hasActive ? 'alert-triangle' : 'trash-2'}
            size={24}
            color={hasActive ? '#E67E22' : '#C0392B'}
          />
        </View>

        <Text style={ds.title}>
          {hasActive ? 'Cannot delete' : `Delete ${count} trip${count !== 1 ? 's' : ''}?`}
        </Text>
        <Text style={ds.body}>
          {hasActive
            ? 'One or more selected trips is currently active. End the trip before deleting it.'
            : `This will permanently remove ${count} trip${count !== 1 ? 's' : ''} and all location pings. This cannot be undone.`}
        </Text>

        <View style={ds.btns}>
          {hasActive ? (
            <Pressable
              style={({ pressed }) => [ds.btn, ds.btnDelete, { flex: 1, backgroundColor: '#1A6B4A' }, pressed && { opacity: 0.8 }]}
              onPress={onCancel}
            >
              <Text style={ds.btnDeleteText}>Got it</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                style={({ pressed }) => [ds.btn, ds.btnKeep, pressed && { opacity: 0.7 }]}
                onPress={onCancel}
                disabled={deleting}
              >
                <Text style={ds.btnKeepText}>Keep them</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [ds.btn, ds.btnDelete, (deleting || pressed) && { opacity: 0.8 }]}
                onPress={onConfirm}
                disabled={deleting}
              >
                {deleting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={ds.btnDeleteText}>Delete</Text>}
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  </Modal>
);

// ── Screen ────────────────────────────────────────────────────────────────────

const FILTER_TABS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'trips', label: 'Trips' },
  { key: 'sos', label: 'SOS Alerts' },
];

const EMPTY_STATE: Record<Filter, { icon: React.ComponentProps<typeof Feather>['name']; title: string; sub?: string }> = {
  all: {
    icon: 'activity',
    title: 'No activity yet',
    sub: "Your trips and SOS alerts will appear here once you start using Hadin's safety features.",
  },
  trips: {
    icon: 'navigation',
    title: 'No trips yet',
    sub: 'Start your first trip from the home screen.',
  },
  sos: {
    icon: 'shield',
    title: 'No SOS alerts. Stay safe.',
  },
};

const RoutesScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [trips, setTrips] = useState<Trip[]>([]);
  const [sosEvents, setSosEvents] = useState<SOSEvent[]>([]);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [tripToDelete, setTripToDelete] = useState<Trip | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showBulkSheet, setShowBulkSheet] = useState(false);
  const [bulkHasActive, setBulkHasActive] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; title: string }>({ visible: false, title: '' });

  const openSwipeRef = useRef<OpenSwipe | null>(null);

  const closeAllSwipes = useCallback(() => {
    if (openSwipeRef.current) {
      Animated.spring(openSwipeRef.current.value, { toValue: 0, useNativeDriver: true }).start();
      openSwipeRef.current = null;
    }
  }, []);

  const loadTrips = useCallback(async () => {
    const { data } = await supabase
      .from('trips')
      .select('*')
      .order('created_at', { ascending: false });
    setTrips((data as Trip[]) ?? []);
  }, []);

  const loadSOS = useCallback(async () => {
    const { data } = await supabase
      .from('sos_events')
      .select('*')
      .order('triggered_at', { ascending: false });
    setSosEvents((data as SOSEvent[]) ?? []);
  }, []);

  const loadAll = useCallback(async () => {
    if (!hasLoadedOnce) setLoading(true);
    await Promise.all([loadTrips(), loadSOS()]);
    setHasLoadedOnce(true);
    setLoading(false);
  }, [hasLoadedOnce, loadTrips, loadSOS]);

  const loadAllRef = useRef(loadAll);
  useEffect(() => { loadAllRef.current = loadAll; }, [loadAll]);

  useEffect(() => {
    loadAllRef.current();
    const channel = supabase
      .channel(`routes-history-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => { loadAllRef.current(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_events' }, () => { loadAllRef.current(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const historyItems = useMemo<HistoryItem[]>(() => {
    const q = query.trim().toLowerCase();
    const tripItems: HistoryItem[] = trips
      .filter((t) => !q || (t.origin ?? '').toLowerCase().includes(q) || (t.destination ?? '').toLowerCase().includes(q))
      .map((t) => ({ kind: 'trip', id: t.id, date: t.created_at, trip: t }));
    const sosItems: HistoryItem[] = q
      ? []
      : sosEvents.map((s) => ({ kind: 'sos', id: s.id, date: s.triggered_at, sos: s }));

    let combined: HistoryItem[];
    if (activeFilter === 'trips') combined = tripItems;
    else if (activeFilter === 'sos') combined = sosItems;
    else combined = [...tripItems, ...sosItems];

    return combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [trips, sosEvents, activeFilter, query]);

  const tripIdsInView = useMemo(
    () => historyItems.filter((i): i is Extract<HistoryItem, { kind: 'trip' }> => i.kind === 'trip').map((i) => i.id),
    [historyItems]
  );

  const tripsById = useMemo(() => {
    const map = new Map<string, Trip>();
    trips.forEach((t) => map.set(t.id, t));
    return map;
  }, [trips]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds([]);
    closeAllSwipes();
  }, [closeAllSwipes]);

  const allFilteredSelected = tripIdsInView.length > 0 && tripIdsInView.every((id) => selectedIds.includes(id));

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, []);

  const handleEnterSelectMode = useCallback((id: string) => {
    setSelectMode(true);
    setSelectedIds([id]);
  }, []);

  const handleDeleteRequest = useCallback((trip: Trip) => {
    setTripToDelete(trip);
    setShowDeleteSheet(true);
  }, []);

  const handleView = useCallback((tripId: string) => {
    navigation.navigate('TripDetail', { tripId });
  }, [navigation]);

  const handleViewSOS = useCallback((sosId: string) => {
    navigation.navigate('SOSDetail', { sosId });
  }, [navigation]);

  const confirmDeleteSingle = async () => {
    if (!tripToDelete) return;
    setDeleting(true);
    try {
      const { error: pingsErr } = await supabase.from('location_pings').delete().eq('trip_id', tripToDelete.id);
      if (pingsErr) console.warn('[Delete] pings error:', pingsErr.message);
      const { error: tripErr } = await supabase.from('trips').delete().eq('id', tripToDelete.id).neq('status', 'active');
      if (tripErr) console.warn('[Delete] trip error:', tripErr.message);
    } catch (e) {
      console.error('[Delete] unexpected error:', e);
    }
    setDeleting(false);
    setShowDeleteSheet(false);
    setTripToDelete(null);
    await loadAll();
    setToast({ visible: true, title: 'Trip deleted' });
  };

  const handleDeleteSelected = () => {
    const hasActive = selectedIds.some((id) => trips.find((t) => t.id === id)?.status === 'active');
    setBulkHasActive(hasActive);
    setShowBulkSheet(true);
  };

  const confirmDeleteBulk = async () => {
    const ids = [...selectedIds];
    const count = ids.length;
    setBulkDeleting(true);
    try {
      const { error: pingsErr } = await supabase.from('location_pings').delete().in('trip_id', ids);
      if (pingsErr) console.warn('[BulkDelete] pings error:', pingsErr.message);
      const { error: tripsErr } = await supabase.from('trips').delete().in('id', ids).neq('status', 'active');
      if (tripsErr) console.warn('[BulkDelete] trips error:', tripsErr.message);
    } catch (e) {
      console.error('[BulkDelete] unexpected error:', e);
    }
    setBulkDeleting(false);
    setShowBulkSheet(false);
    await loadAll();
    exitSelectMode();
    setToast({ visible: true, title: `${count} trip${count !== 1 ? 's' : ''} deleted` });
  };

  const renderItem = useCallback(({ item }: { item: HistoryItem }) => {
    if (item.kind === 'sos') {
      const linkedTrip = item.sos.trip_id ? tripsById.get(item.sos.trip_id) : undefined;
      const tripLabel = linkedTrip ? `${linkedTrip.origin ?? '—'} → ${linkedTrip.destination ?? '—'}` : null;
      return <SOSRow sos={item.sos} tripLabel={tripLabel} onPress={handleViewSOS} />;
    }
    return (
      <TripRow
        trip={item.trip}
        selectMode={selectMode}
        selected={selectedIds.includes(item.id)}
        openSwipeRef={openSwipeRef}
        onToggleSelect={handleToggleSelect}
        onEnterSelectMode={handleEnterSelectMode}
        onView={handleView}
        onDeleteRequest={handleDeleteRequest}
      />
    );
  }, [selectMode, selectedIds, handleToggleSelect, handleEnterSelectMode, handleView, handleDeleteRequest, tripsById, handleViewSOS]);

  const emptyState = query.trim()
    ? { icon: 'search' as const, title: `No results for "${query.trim()}"`, sub: undefined }
    : EMPTY_STATE[activeFilter];

  const hasNoActivity = trips.length === 0 && sosEvents.length === 0 && !query.trim();
  const isFullyEmpty = hasLoadedOnce && !loading && hasNoActivity;
  const showFullEmptyState = isFullyEmpty && historyItems.length === 0;
  const isInitialLoading = loading && !hasLoadedOnce;
  const useQuietHistoryShell = isInitialLoading || isFullyEmpty;

  // ── Frequent destination + weekly overview (footer widgets) ──────────────────

  const frequentDestination = useMemo(() => {
    const counts = new Map<string, number>();
    trips.forEach((t) => {
      if (!t.destination) return;
      counts.set(t.destination, (counts.get(t.destination) ?? 0) + 1);
    });
    let best: string | null = null;
    let bestCount = 0;
    counts.forEach((count, dest) => {
      if (count > bestCount) { best = dest; bestCount = count; }
    });
    return best;
  }, [trips]);

  const weeklyOverview = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const tripsThisWeek = trips.filter((t) => new Date(t.created_at).getTime() >= weekAgo);
    const safeThisWeek = tripsThisWeek.filter((t) => t.status === 'completed').length;
    const lastSOS = sosEvents[0] ?? null;
    return { count: tripsThisWeek.length, safe: safeThisWeek, lastSOS };
  }, [trips, sosEvents]);

  const showFooterWidgets = activeFilter === 'all' && !query.trim() && !isFullyEmpty;

  return (
    <View style={rs.root}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[rs.header, useQuietHistoryShell && rs.emptyHeader, { paddingTop: insets.top + 10 }]}>
        <View style={rs.headerTop}>
          <Pressable style={rs.headerIconBtn} onPress={() => navigation.navigate('Home')} hitSlop={8}>
            <Feather name="arrow-left" size={20} color={H.ink} />
          </Pressable>
          <Text style={rs.headerTitle}>History</Text>
          {useQuietHistoryShell ? (
            <View style={rs.headerIconBtn} />
          ) : (
            <Pressable
              style={rs.headerIconBtn}
              onPress={() => setSearchOpen((v) => !v)}
              hitSlop={8}
            >
              <Feather name={searchOpen ? 'x' : 'search'} size={19} color={H.ink} />
            </Pressable>
          )}
        </View>
        {!useQuietHistoryShell && (
          <Text style={rs.headerSub}>Review your recent safety activity and travel logs.</Text>
        )}

        {!useQuietHistoryShell && searchOpen && (
          <View style={rs.searchRow}>
            <Feather name="search" size={15} color="#9C9A92" />
            <TextInput
              style={rs.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search by destination…"
              placeholderTextColor="#B4B2A9"
              returnKeyType="search"
              autoFocus
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Feather name="x" size={15} color="#9C9A92" />
              </Pressable>
            )}
          </View>
        )}
      </View>

      {/* ── Filter tabs (segmented pill) ──────────────────────────────────── */}
      {!useQuietHistoryShell && (
        <View style={rs.filterWrap}>
          <View style={rs.filterRow}>
            {FILTER_TABS.map(({ key, label }) => (
              <Pressable
                key={key}
                style={[rs.filterTab, activeFilter === key && rs.filterTabActive]}
                onPress={() => setActiveFilter(key)}
              >
                <Text style={[rs.filterLabel, activeFilter === key && rs.filterLabelActive]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* ── Content ────────────────────────────────────────────────────────── */}
      {isInitialLoading ? (
        <View style={rs.centerWrap}>
          <ActivityIndicator color={H.purple} size="large" />
        </View>
      ) : loading && !showFullEmptyState ? (
        <View style={rs.centerWrap}>
          <ActivityIndicator color={H.purple} size="large" />
        </View>
      ) : showFullEmptyState ? (
        <View style={rs.emptyScreen}>
          <View style={rs.emptyCard}>
            <View style={rs.emptyGraphic}>
              <View style={rs.emptyClockCircle}>
                <Feather name="clock" size={44} color="#3F5BD7" />
              </View>
              <View style={rs.emptyShieldBadge}>
                <Feather name="shield" size={15} color="#3F5BD7" />
              </View>
            </View>
            <Text style={rs.emptyTitleLg}>No Activity Yet</Text>
            <Text style={rs.emptySubLg}>
              Your trips and safety alerts will appear here once you start using Hadin features.
              We'll keep a detailed log of your protected movements.
            </Text>

            <Pressable style={rs.startTripBtn} onPress={() => navigation.navigate('Home')}>
              <Text style={rs.startTripBtnText}>START A TRIP</Text>
            </Pressable>
            <Pressable onPress={() => navigation.navigate('Home')}>
              <Text style={rs.returnLink}>Return to Dashboard</Text>
            </Pressable>
          </View>

          <View style={rs.infoChipsRow}>
            <View style={rs.infoChip}>
              <Feather name="shield" size={16} color={H.purple} />
              <Text style={rs.infoChipTitle}>Data Protection</Text>
              <Text style={rs.infoChipSub}>Encrypt data logs for your safety only.</Text>
            </View>
            <View style={rs.infoChip}>
              <Feather name="trending-up" size={16} color={H.purple} />
              <Text style={rs.infoChipTitle}>Route Insights</Text>
              <Text style={rs.infoChipSub}>Review past safety scores.</Text>
            </View>
          </View>
        </View>
      ) : historyItems.length === 0 ? (
        <View style={rs.centerWrap}>
          <View style={rs.emptyIcon}>
            <Feather name={emptyState.icon} size={26} color={H.purple} />
          </View>
          <Text style={rs.emptyTitle}>{emptyState.title}</Text>
          {emptyState.sub && <Text style={rs.emptySub}>{emptyState.sub}</Text>}
        </View>
      ) : (
        <FlatList
          data={historyItems}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          renderItem={renderItem}
          contentContainerStyle={rs.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={H.purple} colors={[H.purple]} />
          }
          ListFooterComponent={
            showFooterWidgets ? (
              <View style={rs.footerWidgets}>
                {frequentDestination && (
                  <View style={rs.mapCard}>
                    <MapView style={rs.mapCardMap} scrollEnabled={false} zoomEnabled={false} pointerEvents="none" />
                    <View style={rs.mapCardOverlay}>
                      <Text style={rs.mapCardLabel}>FREQUENT DESTINATION</Text>
                      <Text style={rs.mapCardValue}>{frequentDestination}</Text>
                    </View>
                  </View>
                )}

                <View style={rs.weeklyCard}>
                  <Text style={rs.weeklyTitle}>Weekly Overview</Text>
                  <Text style={rs.weeklyBody}>
                    {weeklyOverview.count > 0
                      ? `You completed ${weeklyOverview.safe} safe trip${weeklyOverview.safe !== 1 ? 's' : ''} out of ${weeklyOverview.count} this week. `
                      : 'No trips recorded this week. '}
                    {weeklyOverview.lastSOS
                      ? `No critical incidents were reported since your last SOS on ${weekdayName(weeklyOverview.lastSOS.triggered_at)}.`
                      : 'No SOS alerts have been recorded.'}
                  </Text>
                  <Pressable
                    style={rs.pdfBtn}
                    onPress={() => setToast({ visible: true, title: 'PDF export coming soon' })}
                  >
                    <Feather name="download" size={14} color="#fff" />
                    <Text style={rs.pdfBtnText}>Download PDF Report</Text>
                  </Pressable>
                </View>
              </View>
            ) : null
          }
        />
      )}

      {/* ── Bottom nav ─────────────────────────────────────────────────────── */}
      <View style={[rs.bottomNav, { paddingBottom: insets.bottom || 14 }]}>
        <NavItem icon="grid"  label="Dashboard" onPress={() => navigation.navigate('Home')} />
        <NavItem icon="users" label="Circle"    onPress={() => navigation.navigate('Circle')} />
        <NavItem icon="clock" label="History"   active />
        <NavItem icon="user"  label="Profile"   onPress={() => navigation.navigate('Settings')} />
      </View>

      {/* ── Select mode toolbar (covers header) ────────────────────────────── */}
      {selectMode && (
        <View style={[rs.toolbar, { paddingTop: insets.top + 12, paddingBottom: 12 }]}>
          <Pressable style={rs.toolbarLeft} onPress={exitSelectMode}>
            <Feather name="x" size={20} color="#fff" />
            <Text style={rs.toolbarCount}>{selectedIds.length} selected</Text>
          </Pressable>
          <Pressable
            style={rs.toolbarSelectAll}
            onPress={() => setSelectedIds(allFilteredSelected ? [] : tripIdsInView)}
          >
            <Text style={rs.toolbarSelectAllText}>{allFilteredSelected ? 'Deselect all' : 'Select all'}</Text>
          </Pressable>
          <Pressable
            style={[rs.toolbarDeleteChip, selectedIds.length === 0 && rs.toolbarDeleteChipDisabled]}
            onPress={handleDeleteSelected}
            disabled={selectedIds.length === 0}
          >
            <Feather name="trash-2" size={15} color="#fff" />
            <Text style={rs.toolbarDeleteText}>Delete</Text>
          </Pressable>
        </View>
      )}

      <DeleteSheet
        visible={showDeleteSheet}
        trip={tripToDelete}
        deleting={deleting}
        onConfirm={confirmDeleteSingle}
        onCancel={() => { if (!deleting) { setShowDeleteSheet(false); setTripToDelete(null); } }}
      />

      <BulkDeleteSheet
        visible={showBulkSheet}
        count={selectedIds.length}
        hasActive={bulkHasActive}
        deleting={bulkDeleting}
        onConfirm={confirmDeleteBulk}
        onCancel={() => { if (!bulkDeleting) setShowBulkSheet(false); }}
      />

      <SuccessToast
        visible={toast.visible}
        title={toast.title}
        onHide={() => setToast({ visible: false, title: '' })}
      />
    </View>
  );
};

export default RoutesScreen;

// ── Styles ────────────────────────────────────────────────────────────────────

const rs = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8F8FF',
  },

  // Header
  header: {
    backgroundColor: '#F8F8FF',
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#D8DAE2',
  },
  emptyHeader: { paddingBottom: 15 },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 25,
    fontWeight: '800',
    color: '#111827',
  },
  headerSub: {
    fontSize: 12,
    color: H.sub,
    marginTop: 4,
    lineHeight: 17,
  },

  // Search bar
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F4F3EF',
    marginTop: 10,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#1A1A1A',
    height: '100%',
  },

  // Filter tabs — segmented pill
  filterWrap: {
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingBottom: 12,
    paddingTop: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: H.hairline,
  },
  filterRow: {
    flexDirection: 'row',
    backgroundColor: '#F1EFF7',
    borderRadius: 12,
    padding: 3,
    minHeight: 50,
  },
  filterTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  filterTabActive: {
    backgroundColor: H.navy,
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#6B6A73',
  },
  filterLabelActive: {
    color: '#fff',
    fontWeight: '900',
  },

  // FlatList
  listContent: {
    padding: 10,
    paddingHorizontal: 13,
    paddingBottom: 20,
  },

  // Row
  rowOuter: {
    position: 'relative',
    marginBottom: 10,
  },
  swipeActions: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    overflow: 'hidden',
  },
  actionView: {
    width: 62,
    backgroundColor: H.purple,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3,
  },
  actionDelete: {
    width: 62,
    backgroundColor: '#C0392B',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3,
  },
  actionLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: H.hairline,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: 13,
    gap: 9,
  },

  // Checkbox — shown only in select mode
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#E0DED8',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    marginTop: 8,
  },
  checkboxChecked: {
    backgroundColor: H.purple,
    borderColor: H.purple,
  },

  // Trip icon
  tripIcon: {
    width: 31,
    height: 31,
    borderRadius: 9,
    backgroundColor: H.blueLight,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  tripIconSOS: {
    backgroundColor: H.redLight,
  },

  // Info
  info: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tripTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: H.ink,
  },
  timeText: {
    fontSize: 11,
    color: H.sub,
    marginLeft: 8,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: {
    fontSize: 11,
    color: H.sub,
  },
  badgeRow: { flexDirection: 'row', gap: 5 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 0.5,
  },
  badgeGreen: { backgroundColor: H.greenLight, borderColor: '#C6E8D5' },
  badgeGreenText: { color: H.greenText },
  badgeCyan: { backgroundColor: H.cyanLight, borderColor: '#BFE6EC' },
  badgeCyanText: { color: H.cyanText },
  badgeBlue: { backgroundColor: H.blueLight, borderColor: '#C9DCFB' },
  badgeBlueText: { color: H.blue },
  badgeRed: { backgroundColor: H.redLight, borderColor: '#F9C6C6' },
  badgeRedText: { color: '#A32D2D' },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },

  // Frequent destination map card
  footerWidgets: { gap: 12, marginTop: 4 },
  mapCard: {
    height: 130,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: H.hairline,
  },
  mapCardMap: { flex: 1 },
  mapCardOverlay: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mapCardLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: H.sub,
    letterSpacing: 0.4,
  },
  mapCardValue: {
    fontSize: 13,
    fontWeight: '800',
    color: H.ink,
    marginTop: 2,
  },

  // Weekly overview card
  weeklyCard: {
    backgroundColor: H.navy,
    borderRadius: 16,
    padding: 16,
  },
  weeklyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 6,
  },
  weeklyBody: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 18,
    marginBottom: 14,
  },
  pdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: H.purple,
    borderRadius: 12,
    paddingVertical: 12,
  },
  pdfBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },

  // Bottom nav
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#E8EEFF',
    borderTopWidth: 0.5,
    borderTopColor: H.hairline,
    paddingTop: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  navActiveBar: {
    width: 16,
    height: 2,
    backgroundColor: H.purple,
    borderRadius: 2,
  },
  navLabel: {
    fontSize: 10,
    color: '#9C9A92',
  },
  navLabelActive: {
    color: H.purple,
    fontWeight: '600',
  },

  // Select mode toolbar
  toolbar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: H.navy,
    paddingHorizontal: 18,
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolbarCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  toolbarSelectAll: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  toolbarSelectAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
  },
  toolbarDeleteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  toolbarDeleteChipDisabled: {
    opacity: 0.35,
  },
  toolbarDeleteText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },

  // Loading / small empty
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.screenPadding,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: H.purpleLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    color: '#9C9A92',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Full "No Activity Yet" empty screen
  emptyScreen: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 26,
    paddingTop: 76,
  },
  emptyCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C9CBD6',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 31,
    marginBottom: 74,
  },
  emptyGraphic: {
    width: 128,
    height: 118,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyClockCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#DCE5FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyShieldBadge: {
    position: 'absolute',
    right: 24,
    bottom: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD0DF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitleLg: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  emptySubLg: {
    fontSize: 16,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 45,
  },
  startTripBtn: {
    alignSelf: 'stretch',
    backgroundColor: H.purple,
    borderRadius: 0,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 19,
    shadowColor: '#111827',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  startTripBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1.2,
  },
  returnLink: {
    fontSize: 14,
    fontWeight: '500',
    color: '#3047D9',
  },
  infoChipsRow: {
    flexDirection: 'row',
    gap: 22,
    alignSelf: 'stretch',
  },
  infoChip: {
    flex: 1,
    backgroundColor: 'transparent',
    borderLeftWidth: 2,
    borderLeftColor: '#DCE5FF',
    paddingLeft: 13,
    paddingTop: 12,
    minHeight: 101,
    gap: 7,
  },
  infoChipTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  infoChipSub: {
    fontSize: 12,
    color: '#374151',
    lineHeight: 16,
  },
});

// ── Delete sheet styles ───────────────────────────────────────────────────────

const ds = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  dismiss: { flex: 1 },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingBottom: 24,
    alignItems: 'center',
  },
  handleRow: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 0,
  },
  handle: {
    width: 32,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FDEDEC',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1A1A1A',
    marginBottom: 6,
  },
  body: {
    fontSize: 12,
    color: '#9C9A92',
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 8,
    marginBottom: 16,
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#F4F3EF',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 13,
    gap: 10,
    marginBottom: 16,
  },
  previewIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#EFF9F4',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  previewIconSOS: {
    backgroundColor: '#FDEDEC',
  },
  previewInfo: { flex: 1 },
  previewRoute: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  previewMeta: {
    fontSize: 11,
    color: '#9C9A92',
    marginTop: 2,
  },
  btns: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: 10,
  },
  btn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnKeep: {
    backgroundColor: '#F4F3EF',
  },
  btnKeepText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#9C9A92',
  },
  btnDelete: {
    backgroundColor: '#C0392B',
  },
  btnDeleteText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});

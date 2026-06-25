import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
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
import { colors, spacing } from '../../styles/tokens';
import { Trip } from '../trip/StartTripModal';
import SuccessToast from '../../components/SuccessToast';

// ── Types ─────────────────────────────────────────────────────────────────────

type Filter = 'all' | 'completed' | 'sos' | 'active';

interface TripMetrics {
  total: number;
  safe: number;
  sos: number;
  active: number;
}

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
  if (h === 0) return `${m}min`;
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

function computeMetrics(trips: Trip[]): TripMetrics {
  return {
    total: trips.length,
    safe: trips.filter((t) => t.status === 'completed').length,
    sos: trips.filter((t) => t.status === 'sos').length,
    active: trips.filter((t) => t.status === 'active').length,
  };
}

// ── Metric box ────────────────────────────────────────────────────────────────

const MetricBox = ({ label, value, valueColor }: { label: string; value: number; valueColor: string }) => (
  <View style={rs.metricBox}>
    <Text style={[rs.metricValue, { color: valueColor }]}>{value}</Text>
    <Text style={rs.metricLabel}>{label}</Text>
  </View>
);

// ── Bottom nav bar ────────────────────────────────────────────────────────────

interface NavItemProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  active?: boolean;
  onPress?: () => void;
}

const NavItem = ({ icon, label, active = false, onPress }: NavItemProps) => (
  <Pressable style={rs.navItem} onPress={onPress}>
    <Feather name={icon} size={22} color={active ? '#1A6B4A' : '#9C9A92'} />
    {active && <View style={rs.navActiveBar} />}
    <Text style={[rs.navLabel, active && rs.navLabelActive]}>{label}</Text>
  </Pressable>
);

// ── Swipe row ─────────────────────────────────────────────────────────────────

const SWIPE_ACTION_WIDTH = 124; // 62px × 2
const SWIPE_THRESHOLD = 80;

interface TripRowProps {
  trip: Trip;
  selectMode: boolean;
  selected: boolean;
  openSwipeRef: React.MutableRefObject<OpenSwipe | null>;
  onToggleSelect: (id: string) => void;
  onView: (id: string) => void;
  onDeleteRequest: (trip: Trip) => void;
}

const TripRow = React.memo(
  ({ trip, selectMode, selected, openSwipeRef, onToggleSelect, onView, onDeleteRequest }: TripRowProps) => {
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
    };

    const isSOS = trip.status === 'sos';
    const isActive = trip.status === 'active';
    const duration = formatDuration(trip.started_at, trip.ended_at);
    const dateStr = formatTripDate(trip.created_at);

    const meta = isActive
      ? `${dateStr}  ·  In progress`
      : `${dateStr}${duration ? `  ·  ${duration}` : ''}`;

    const badgeLabel = isSOS ? 'SOS fired' : isActive ? 'Active' : 'Safe';

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
          <Pressable style={rs.cardInner} onPress={handlePress}>
            {/* Checkbox — always visible */}
            <View style={[rs.checkbox, selected && rs.checkboxChecked]}>
              {selected && <Feather name="check" size={11} color="#fff" />}
            </View>

            {/* Route icon */}
            <View style={[rs.routeIcon, isSOS && rs.routeIconSOS]}>
              <Feather
                name={isSOS ? 'alert-triangle' : 'navigation'}
                size={16}
                color={isSOS ? '#C0392B' : '#1A6B4A'}
              />
            </View>

            {/* Info */}
            <View style={rs.info}>
              <Text style={rs.route} numberOfLines={1}>
                {trip.origin ?? '—'}  →  {trip.destination ?? '—'}
              </Text>
              <Text style={rs.meta}>{meta}</Text>
            </View>

            {/* Badge + date */}
            <View style={rs.rightCol}>
              <View style={[rs.badge, isSOS ? rs.badgeSOS : rs.badgeSafe]}>
                <Text style={[rs.badgeText, isSOS ? rs.badgeSOSText : rs.badgeSafeText]}>
                  {badgeLabel}
                </Text>
              </View>
              <Text style={rs.dateText}>{dateStr}</Text>
            </View>

            {/* Chevron — hidden in select mode */}
            {!selectMode && (
              <Feather name="chevron-right" size={14} color="#D0CEC8" />
            )}
          </Pressable>
        </Animated.View>
      </View>
    );
  }
);

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
  { key: 'completed', label: 'Safe' },
  { key: 'sos', label: 'SOS' },
  { key: 'active', label: 'Active' },
];

const EMPTY_TITLES: Record<Filter, string> = {
  all: 'No trips yet',
  completed: 'No safe trips',
  sos: 'No SOS trips',
  active: 'No active trips',
};

const RoutesScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [trips, setTrips] = useState<Trip[]>([]);
  const [filtered, setFiltered] = useState<Trip[]>([]);
  const [activeFilter, setActiveFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [tripToDelete, setTripToDelete] = useState<Trip | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showBulkSheet, setShowBulkSheet] = useState(false);
  const [bulkHasActive, setBulkHasActive] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [metrics, setMetrics] = useState<TripMetrics>({ total: 0, safe: 0, sos: 0, active: 0 });
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
    const rows = (data as Trip[]) ?? [];
    setTrips(rows);
    setMetrics(computeMetrics(rows));
    setLoading(false);
  }, []);

  const loadTripsRef = useRef(loadTrips);
  useEffect(() => { loadTripsRef.current = loadTrips; }, [loadTrips]);

  useEffect(() => {
    loadTripsRef.current();
    const channel = supabase
      .channel(`routes-trips-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => { loadTripsRef.current(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    setFiltered(
      activeFilter === 'all' ? trips : trips.filter((t) => t.status === activeFilter)
    );
  }, [trips, activeFilter]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds([]);
    closeAllSwipes();
  }, [closeAllSwipes]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((t) => selectedIds.includes(t.id));

  const handleSelectAll = () => {
    if (!selectMode) {
      setSelectMode(true);
      setSelectedIds(filtered.map((t) => t.id));
      return;
    }
    setSelectedIds(allFilteredSelected ? [] : filtered.map((t) => t.id));
  };

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, []);

  const handleDeleteRequest = useCallback((trip: Trip) => {
    setTripToDelete(trip);
    setShowDeleteSheet(true);
  }, []);

  const handleView = useCallback((tripId: string) => {
    navigation.navigate('TripDetail', { tripId });
  }, [navigation]);

  const confirmDeleteSingle = async () => {
    if (!tripToDelete) return;
    setDeleting(true);
    await supabase.from('location_pings').delete().eq('trip_id', tripToDelete.id);
    await supabase.from('trips').delete().eq('id', tripToDelete.id).neq('status', 'active');
    setDeleting(false);
    setShowDeleteSheet(false);
    setTripToDelete(null);
    await loadTrips();
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
    for (const id of ids) {
      await supabase.from('location_pings').delete().eq('trip_id', id);
      await supabase.from('trips').delete().eq('id', id).neq('status', 'active');
    }
    setBulkDeleting(false);
    setShowBulkSheet(false);
    await loadTrips();
    exitSelectMode();
    setToast({ visible: true, title: `${count} trip${count !== 1 ? 's' : ''} deleted` });
  };

  const renderItem = useCallback(({ item }: { item: Trip }) => (
    <TripRow
      trip={item}
      selectMode={selectMode}
      selected={selectedIds.includes(item.id)}
      openSwipeRef={openSwipeRef}
      onToggleSelect={handleToggleSelect}
      onView={handleView}
      onDeleteRequest={handleDeleteRequest}
    />
  ), [selectMode, selectedIds, handleToggleSelect, handleView, handleDeleteRequest]);

  return (
    <View style={rs.root}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[rs.header, { paddingTop: insets.top + 10 }]}>
        <View>
          <Text style={rs.headerTitle}>My routes</Text>
          <Text style={rs.headerSub}>Your travel history</Text>
        </View>
        <Pressable style={rs.selectAllBtn} onPress={handleSelectAll}>
          <View style={[rs.selectAllBox, allFilteredSelected && rs.selectAllBoxChecked]}>
            {allFilteredSelected && <Feather name="check" size={12} color="#fff" />}
          </View>
          <Text style={rs.selectAllLabel}>Select all</Text>
        </Pressable>
      </View>

      {/* ── Metrics strip ──────────────────────────────────────────────────── */}
      <View style={rs.metricsStrip}>
        <MetricBox label="Total trips" value={metrics.total} valueColor="#1A1A1A" />
        <MetricBox label="Safe"        value={metrics.safe}  valueColor="#1A6B4A" />
        <MetricBox label="SOS fired"   value={metrics.sos}   valueColor="#C0392B" />
        <MetricBox label="Active"      value={metrics.active} valueColor="#1D9E75" />
      </View>

      {/* ── Filter tabs ────────────────────────────────────────────────────── */}
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

      {/* ── Content ────────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={rs.centerWrap}>
          <ActivityIndicator color="#1A6B4A" size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={rs.centerWrap}>
          <View style={rs.emptyIcon}>
            <Feather name="navigation" size={26} color="#1A6B4A" />
          </View>
          <Text style={rs.emptyTitle}>{EMPTY_TITLES[activeFilter]}</Text>
          {activeFilter === 'all' && (
            <Text style={rs.emptySub}>Start your first trip from the home screen.</Text>
          )}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={rs.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ── Bottom nav ─────────────────────────────────────────────────────── */}
      <View style={[rs.bottomNav, { paddingBottom: insets.bottom || 14 }]}>
        <NavItem icon="home"     label="Home"     onPress={() => navigation.navigate('Home')} />
        <NavItem icon="map"      label="Routes"   active />
        <NavItem icon="users"    label="Circle"   onPress={() => navigation.navigate('Circle')} />
        <NavItem icon="settings" label="Settings" />
      </View>

      {/* ── Select mode toolbar (covers header) ────────────────────────────── */}
      {selectMode && (
        <View style={[rs.toolbar, { paddingTop: insets.top + 12, paddingBottom: 12 }]}>
          <Pressable style={rs.toolbarLeft} onPress={exitSelectMode}>
            <Feather name="x" size={20} color="#fff" />
            <Text style={rs.toolbarCount}>{selectedIds.length} selected</Text>
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
    backgroundColor: '#F4F3EF',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEECe6',
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#1A1A1A',
    letterSpacing: -0.03 * 21,
  },
  headerSub: {
    fontSize: 11,
    color: '#9C9A92',
    marginTop: 2,
  },
  selectAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectAllBox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#E0DED8',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectAllBoxChecked: {
    backgroundColor: '#1A6B4A',
    borderColor: '#1A6B4A',
  },
  selectAllLabel: {
    fontSize: 11,
    color: '#9C9A92',
  },

  // Metrics
  metricsStrip: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingVertical: 13,
    gap: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEECe6',
  },
  metricBox: {
    flex: 1,
    backgroundColor: '#F4F3EF',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#EEECe6',
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  metricLabel: {
    fontSize: 10,
    color: '#9C9A92',
    marginTop: 2,
    textAlign: 'center',
  },

  // Filter tabs
  filterRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEECe6',
  },
  filterTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  filterTabActive: {
    borderBottomColor: '#1A6B4A',
  },
  filterLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#9C9A92',
  },
  filterLabelActive: {
    color: '#1A6B4A',
    fontWeight: '700',
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
    marginBottom: 8,
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
    backgroundColor: '#1A6B4A',
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
    borderColor: '#EEECe6',
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 13,
    gap: 10,
  },

  // Checkbox — always visible per design
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
  },
  checkboxChecked: {
    backgroundColor: '#1A6B4A',
    borderColor: '#1A6B4A',
  },

  // Route icon
  routeIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#EFF9F4',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  routeIconSOS: {
    backgroundColor: '#FDEDEC',
  },

  // Info
  info: { flex: 1 },
  route: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  meta: {
    fontSize: 10,
    color: '#9C9A92',
    marginTop: 2,
  },

  // Right column
  rightCol: {
    alignItems: 'flex-end',
    gap: 4,
    flexShrink: 0,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 0.5,
  },
  badgeSafe: {
    backgroundColor: '#EFF9F4',
    borderColor: '#C6E8D5',
  },
  badgeSafeText: {
    color: '#0F6E56',
  },
  badgeSOS: {
    backgroundColor: '#FDEDEC',
    borderColor: '#F9C6C6',
  },
  badgeSOSText: {
    color: '#A32D2D',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  dateText: {
    fontSize: 10,
    color: '#B4B2A9',
  },

  // Bottom nav
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: 0.5,
    borderTopColor: '#EEECe6',
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
    backgroundColor: '#1A6B4A',
    borderRadius: 2,
  },
  navLabel: {
    fontSize: 10,
    color: '#9C9A92',
  },
  navLabelActive: {
    color: '#1A6B4A',
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
    backgroundColor: '#1A6B4A',
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

  // Loading / empty
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
    backgroundColor: '#EFF9F4',
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

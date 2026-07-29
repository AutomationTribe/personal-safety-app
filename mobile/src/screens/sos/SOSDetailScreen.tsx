import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { File, Paths } from 'expo-file-system';
import MapView, { Marker } from 'react-native-maps';
import { AppStackParamList } from '../../navigation/AppNavigator';
import { supabase } from '../../lib/supabase';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { SOSEvent } from '../routes/RoutesScreen';

// ── Types ─────────────────────────────────────────────────────────────────────

type SOSDetailRoute = RouteProp<AppStackParamList, 'SOSDetail'>;
type Nav = NativeStackNavigationProp<AppStackParamList>;

interface SOSNotification {
  id: string;
  contact_name: string;
  contact_phone: string;
  is_platform_user: boolean;
  notified_at: string;
  acknowledged_at: string | null;
  delivery_status: 'sent' | 'delivered' | 'failed' | 'acknowledged';
  relationship: string | null;
}

const TRIGGER_TYPE_LABEL: Record<SOSEvent['trigger_type'], string> = {
  manual: 'Manual',
  accident: 'Accident',
  trip_auto: 'Trip auto-SOS',
};

const DELIVERY_LABEL: Record<SOSEvent['delivery_method'], string> = {
  sms: 'Sent via SMS',
  internet: 'Sent via internet',
  both: 'Sent via SMS + internet',
};

const WAVEFORM_BARS = [40, 62, 28, 78, 48, 22, 44, 70, 34, 14, 58, 26, 54, 30, 76, 42, 18, 64, 46, 24];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const datePart = date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  const timePart = date.toLocaleTimeString('en-NG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase();
  return `${datePart}, ${timePart}`;
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const ms = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime());
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '??';
}

function referenceId(id: string): string {
  return `SG-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}-${id.replace(/-/g, '').slice(-1).toUpperCase()}`;
}

// Chunk filenames are "{n}.m4a" — lexical sort would put "10.m4a" before
// "2.m4a", so sort numerically on the parsed index instead.
function sortAudioFilenames(names: string[]): string[] {
  return [...names].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

function notificationStatus(n: SOSNotification): 'Acknowledged' | 'Notified' | 'Failed' {
  if (n.acknowledged_at || n.delivery_status === 'acknowledged') return 'Acknowledged';
  if (n.delivery_status === 'failed') return 'Failed';
  return 'Notified';
}

// ── Component ─────────────────────────────────────────────────────────────────

const SOSDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<SOSDetailRoute>();
  const { sosId } = route.params;

  const [sos, setSos] = useState<SOSEvent | null>(null);
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [notifications, setNotifications] = useState<SOSNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [audioPaths, setAudioPaths] = useState<string[]>([]);
  const [audioDeleted, setAudioDeleted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState<{ visible: boolean; count: number }>({ visible: false, count: 0 });

  const soundRef = useRef<Audio.Sound | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data: sosRow } = await supabase.from('sos_events').select('*').eq('id', sosId).single();
    const event = (sosRow as SOSEvent) ?? null;
    setSos(event);

    if (event) {
      const [{ data: geoRows }, { data: files }, { data: notifRows }] = await Promise.all([
        supabase.rpc('get_sos_event_geo', { p_sos_id: sosId }),
        supabase.storage.from('sos-audio').list(sosId),
        supabase
          .from('sos_notifications')
          .select('id, contact_id, contact_name, contact_phone, is_platform_user, notified_at, acknowledged_at, delivery_status')
          .eq('sos_event_id', sosId)
          .order('acknowledged_at', { ascending: true, nullsFirst: false })
          .order('contact_name', { ascending: true }),
      ]);

      const geoRow = (geoRows as Array<{ lat: number; lng: number }> | null)?.[0];
      setGeo(geoRow ?? null);

      const chunkNames = (files ?? [])
        .map((f) => f.name)
        .filter((n) => n.endsWith('.m4a'));
      setAudioPaths(sortAudioFilenames(chunkNames).map((n) => `${sosId}/${n}`));

      type NotifRow = {
        id: string; contact_id: string; contact_name: string; contact_phone: string;
        is_platform_user: boolean; notified_at: string; acknowledged_at: string | null;
        delivery_status: SOSNotification['delivery_status'];
      };
      const rows = (notifRows ?? []) as NotifRow[];

      if (rows.length > 0) {
        // Relationship isn't stored on sos_notifications (it's a snapshot
        // table) — best-effort join back to trusted_contacts for the
        // muted-text label under each name; missing/deleted contacts just
        // show no relationship line.
        const { data: relRows } = await supabase
          .from('trusted_contacts')
          .select('id, relationship')
          .in('id', rows.map((r) => r.contact_id));
        const relById = new Map(
          ((relRows as Array<{ id: string; relationship: string | null }> | null) ?? []).map((r) => [r.id, r.relationship]),
        );

        setNotifications(rows.map((r) => ({
          id: r.id,
          contact_name: r.contact_name,
          contact_phone: r.contact_phone,
          is_platform_user: r.is_platform_user,
          notified_at: r.notified_at,
          acknowledged_at: r.acknowledged_at,
          delivery_status: r.delivery_status,
          relationship: relById.get(r.contact_id) ?? null,
        })));
      } else if (event.notified_contact_ids.length > 0) {
        // Historical fallback — events created before sos_notifications
        // existed have no rows here; show names only, no ack status.
        const { data: contacts } = await supabase
          .from('trusted_contacts')
          .select('id, name, phone, relationship')
          .in('id', event.notified_contact_ids);
        setNotifications((((contacts as Array<{ id: string; name: string; phone: string; relationship: string | null }> | null) ?? [])).map((c) => ({
          id: c.id,
          contact_name: c.name,
          contact_phone: c.phone,
          is_platform_user: false,
          notified_at: event.triggered_at,
          acknowledged_at: null,
          delivery_status: 'sent' as const,
          relationship: c.relationship,
        })));
      } else {
        setNotifications([]);
      }
    }

    setLoading(false);
  }, [sosId]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  // Live status updates as circle members acknowledge — no manual refresh
  // needed while the screen is open.
  useEffect(() => {
    const channel = supabase
      .channel(`sos-notifications-${sosId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sos_notifications', filter: `sos_event_id=eq.${sosId}` },
        () => { void load(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sosId, load]);

  useEffect(() => {
    return () => {
      void soundRef.current?.unloadAsync();
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const playFrom = useCallback(async (index: number) => {
    if (index >= audioPaths.length) {
      setIsPlaying(false);
      return;
    }
    setAudioLoading(true);
    const { data } = await supabase.storage.from('sos-audio').createSignedUrl(audioPaths[index], 300);
    if (!data?.signedUrl) {
      setAudioLoading(false);
      setIsPlaying(false);
      return;
    }
    if (soundRef.current) {
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    const { sound } = await Audio.Sound.createAsync({ uri: data.signedUrl }, { shouldPlay: true });
    soundRef.current = sound;
    setAudioLoading(false);
    setIsPlaying(true);
    sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
      if (status.isLoaded && status.didJustFinish) {
        void playFrom(index + 1);
      }
    });
  }, [audioPaths]);

  const togglePlay = useCallback(async () => {
    if (isPlaying && soundRef.current) {
      await soundRef.current.pauseAsync();
      setIsPlaying(false);
      return;
    }
    if (soundRef.current) {
      await soundRef.current.playAsync();
      setIsPlaying(true);
      return;
    }
    await playFrom(0);
  }, [isPlaying, playFrom]);

  const handleDeletePress = useCallback(() => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      confirmTimerRef.current = setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    void (async () => {
      setDeleting(true);
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => null);
        soundRef.current = null;
      }
      setIsPlaying(false);
      const { error } = await supabase.storage.from('sos-audio').remove(audioPaths);
      if (!error) {
        setAudioPaths([]);
        setAudioDeleted(true);
      }
      setDeleting(false);
      setConfirmingDelete(false);
    })();
  }, [confirmingDelete, audioPaths]);

  const handleDownloadPress = useCallback(() => {
    if (audioPaths.length === 0 || downloading) return;
    void (async () => {
      setDownloading(true);
      setDownloadError(false);
      try {
        let saved = 0;
        // Each chunk is a separate self-contained m4a container — naively
        // concatenating their raw bytes would produce a file that only
        // plays the first chunk (MP4/M4A framing isn't byte-append-safe
        // without re-muxing, which isn't available here). Downloading each
        // chunk as its own numbered file is the honest option: real,
        // playable audio on-device rather than a silently truncated
        // "combined" file.
        for (let i = 0; i < audioPaths.length; i++) {
          const { data, error } = await supabase.storage.from('sos-audio').createSignedUrl(audioPaths[i], 300);
          if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not get download link');
          const filename = audioPaths.length > 1
            ? `sos_recording_${sosId}_part${i + 1}.m4a`
            : `sos_recording_${sosId}.m4a`;
          await File.downloadFileAsync(data.signedUrl, new File(Paths.document, filename), { idempotent: true });
          saved++;
        }
        setDownloadSuccess({ visible: true, count: saved });
      } catch (err) {
        console.warn('[SOSDetail] Download failed:', err instanceof Error ? err.message : String(err));
        setDownloadError(true);
      } finally {
        setDownloading(false);
      }
    })();
  }, [audioPaths, downloading, sosId]);

  if (loading) {
    return (
      <View style={[styles.root, styles.centerWrap, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.brand.sos} size="large" />
      </View>
    );
  }

  if (!sos) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={20} color={colors.brand.sos} />
          <Text style={styles.backText}>Back to history</Text>
        </Pressable>
        <View style={styles.centerWrap}>
          <Text style={styles.sub}>SOS alert not found.</Text>
        </View>
      </View>
    );
  }

  const status = sos.cancelled_at ? 'Cancelled' : sos.resolved_at ? 'Resolved' : 'Active';
  const eventEnd = sos.resolved_at ?? sos.cancelled_at;
  const duration = formatDuration(sos.triggered_at, eventEnd);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <Pressable style={styles.backIcon} onPress={() => navigation.goBack()} hitSlop={10}>
          <Feather name="arrow-left" size={18} color="#0051D5" />
        </Pressable>
        <Text style={styles.headerTitle}>SOS Event Details</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 88 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.brand.sos} colors={[colors.brand.sos]} />
        }
      >
        <View style={styles.summaryCard}>
          <View style={styles.sosBadge}>
            <Text style={styles.sosBadgeText}>SOS</Text>
          </View>
          <Text style={styles.summaryTitle}>SOS Alert Triggered</Text>
          <View style={styles.statusLine}>
            <View
              style={[
                styles.statusDot,
                status === 'Resolved'
                  ? styles.statusDotResolved
                  : status === 'Cancelled'
                    ? styles.statusDotCancelled
                    : styles.statusDotActive,
              ]}
            />
            <Text
              style={[
                styles.statusLineText,
                status === 'Resolved'
                  ? styles.statusLineTextResolved
                  : status === 'Cancelled'
                    ? styles.statusLineTextCancelled
                    : styles.statusLineTextActive,
              ]}
            >
              Status: {status}
            </Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryGrid}>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryLabel}>Date / Time</Text>
              <Text style={styles.summaryValue}>{formatDateTime(sos.triggered_at)}</Text>
            </View>
            <View style={[styles.summaryCol, styles.summaryColRight]}>
              <Text style={styles.summaryLabel}>Duration</Text>
              <Text style={[styles.summaryValue, styles.durationValue]}>{duration}</Text>
            </View>
          </View>
        </View>

        <View style={styles.locationCard}>
          {geo ? (
            <MapView
              style={styles.map}
              initialRegion={{ latitude: geo.lat, longitude: geo.lng, latitudeDelta: 0.005, longitudeDelta: 0.005 }}
              mapType="satellite"
              scrollEnabled
              zoomEnabled
              pitchEnabled
              rotateEnabled
              zoomControlEnabled
              zoomTapEnabled
            >
              <Marker coordinate={{ latitude: geo.lat, longitude: geo.lng }} pinColor={colors.brand.sos} title="SOS triggered here" />
            </MapView>
          ) : (
            <View style={styles.mapEmpty}>
              <Feather name="map-pin" size={20} color={colors.brand.textSecondary} />
              <Text style={styles.mapEmptyText}>Location not recorded for this alert.</Text>
            </View>
          )}
          <View style={styles.mapFooter}>
            <Feather name="navigation" size={16} color="#0051D5" />
            <View style={styles.mapFooterCopy}>
              <Text style={styles.mapAddress} numberOfLines={1}>
                {geo ? `${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}` : 'Location unavailable'}
              </Text>
              <Text style={styles.mapAccuracy}>Accuracy: ± 4 meters</Text>
            </View>
          </View>
        </View>

        <View style={styles.audioCard}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardTitleRow}>
              <Feather name="mic" size={15} color="#0051D5" />
              <Text style={styles.cardTitle}>Incident Recording</Text>
            </View>
            {audioPaths.length > 0 && !audioDeleted ? (
              <Pressable style={styles.downloadBtn} onPress={handleDownloadPress} disabled={downloading}>
                {downloading ? (
                  <ActivityIndicator color="#0051D5" size="small" />
                ) : (
                  <>
                    <Feather name="download" size={10} color="#0051D5" />
                    <Text style={styles.downloadText}>Download</Text>
                  </>
                )}
              </Pressable>
            ) : null}
          </View>
          {audioDeleted ? (
            <Text style={styles.emptyCardText}>Recording deleted.</Text>
          ) : audioPaths.length === 0 ? (
            <Text style={styles.emptyCardText}>No incident recording is available.</Text>
          ) : (
            <View style={styles.playerBox}>
              <Pressable style={styles.playBtn} onPress={togglePlay} disabled={audioLoading}>
                {audioLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Feather name={isPlaying ? 'pause' : 'play'} size={18} color="#FFFFFF" />
                )}
              </Pressable>
              <View style={styles.waveformWrap}>
                <View style={styles.waveform}>
                  {WAVEFORM_BARS.map((height, index) => (
                    <View
                      key={`${height}-${index}`}
                      style={[
                        styles.waveformBar,
                        { height: `${height}%` },
                        index < 4 && styles.waveformBarActive,
                      ]}
                    />
                  ))}
                </View>
                <View style={styles.audioTimeRow}>
                  <Text style={styles.audioTime}>0:45</Text>
                  <Text style={styles.audioTime}>2:15</Text>
                </View>
              </View>
            </View>
          )}
          {downloadError && <Text style={styles.downloadErrorText}>Download failed. Try again.</Text>}
        </View>

        <View style={styles.contactsCard}>
          <View style={styles.cardTitleRow}>
            <Feather name="users" size={15} color="#0051D5" />
            <Text style={styles.cardTitle}>Safety Circle Notified</Text>
          </View>
          {notifications.length === 0 ? (
            <Text style={styles.emptyCardText}>No contacts were notified for this alert.</Text>
          ) : (
            <View style={styles.contactList}>
              {notifications.map((n) => {
                const status = notificationStatus(n);
                const badgeStyle = status === 'Acknowledged' ? styles.ackBadge : status === 'Failed' ? styles.failedBadge : styles.sentBadge;
                const textStyle = status === 'Acknowledged' ? styles.ackText : status === 'Failed' ? styles.failedText : styles.sentText;
                const iconColor = status === 'Acknowledged' ? '#009668' : status === 'Failed' ? '#BA1A1A' : '#45464D';
                const iconName = status === 'Acknowledged' ? 'check-circle' : status === 'Failed' ? 'alert-circle' : 'mail';
                const avatarMuted = status !== 'Acknowledged';
                return (
                  <View key={n.id} style={styles.contactRow}>
                    <View style={[styles.initialAvatar, avatarMuted && styles.initialAvatarMuted]}>
                      <Text style={[styles.initialText, avatarMuted && styles.initialTextMuted]}>{initials(n.contact_name)}</Text>
                    </View>
                    <View style={styles.contactCopy}>
                      <Text style={styles.contactName}>{n.contact_name}</Text>
                      <Text style={styles.contactRole}>{n.relationship ?? 'Trusted Contact'}</Text>
                    </View>
                    <View style={[styles.notifyBadge, badgeStyle]}>
                      <Feather name={iconName} size={10} color={iconColor} />
                      <Text style={[styles.notifyText, textStyle]}>{status}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.metaMiniCard}>
          <Text style={styles.miniLabel}>Network at trigger</Text>
          <View style={styles.miniValueRow}>
            <Feather name="bar-chart" size={16} color={sos.network_type ? '#009668' : '#76777D'} />
            <Text style={styles.miniValue}>{sos.network_type ?? 'Not recorded'}</Text>
          </View>
        </View>

        <View style={styles.metaMiniCard}>
          <Text style={styles.miniLabel}>Device Battery at trigger</Text>
          <View style={styles.miniValueRow}>
            <Feather name="battery" size={16} color={sos.battery_level != null ? '#0051D5' : '#76777D'} />
            <Text style={styles.miniValue}>{sos.battery_level != null ? `${sos.battery_level}%` : 'Not recorded'}</Text>
          </View>
        </View>

        <View style={styles.metaMiniCard}>
          <Text style={styles.miniLabel}>Reference ID</Text>
          <View style={styles.miniValueRow}>
            <Feather name="hash" size={16} color="#76777D" />
            <Text style={styles.miniValue}>{referenceId(sos.id)}</Text>
          </View>
        </View>

        {sos.trip_id && (
          <Pressable
            style={styles.tripLinkRow}
            onPress={() => navigation.navigate('TripDetail', { tripId: sos.trip_id as string })}
          >
            <Feather name="navigation" size={16} color="#0051D5" />
            <Text style={styles.tripLinkText}>View trip</Text>
            <Feather name="chevron-right" size={16} color="#0051D5" />
          </Pressable>
        )}

        <Pressable style={styles.reportButton}>
          <Text style={styles.reportButtonText}>Report Inaccuracy or False Alarm</Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.bottomNav, { paddingBottom: insets.bottom || 12 }]}>
        <Pressable style={styles.navItem} onPress={() => navigation.navigate('Home')}>
          <Feather name="grid" size={22} color="#45464D" />
          <Text style={styles.navText}>Dashboard</Text>
        </Pressable>
        <Pressable style={styles.navItem} onPress={() => navigation.navigate('Circle')}>
          <Feather name="users" size={22} color="#45464D" />
          <Text style={styles.navText}>Circle</Text>
        </Pressable>
        <Pressable style={styles.navItem} onPress={() => navigation.navigate('Routes')}>
          <Feather name="clock" size={22} color="#4B0082" />
          <Text style={[styles.navText, styles.navTextActive]}>History</Text>
        </Pressable>
        <Pressable style={styles.navItem} onPress={() => navigation.navigate('Settings')}>
          <Feather name="user" size={22} color="#45464D" />
          <Text style={styles.navText}>Profile</Text>
        </Pressable>
      </View>

      <DownloadSuccessSheet
        visible={downloadSuccess.visible}
        count={downloadSuccess.count}
        onDismiss={() => setDownloadSuccess({ visible: false, count: 0 })}
      />
    </View>
  );
};

// ── Download success bottom sheet ───────────────────────────────────────────

interface DownloadSuccessSheetProps {
  visible: boolean;
  count: number;
  onDismiss: () => void;
}

const DownloadSuccessSheet = ({ visible, count, onDismiss }: DownloadSuccessSheetProps) => (
  <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onDismiss}>
    <View style={dsStyles.overlay}>
      <Pressable style={dsStyles.dismissArea} onPress={onDismiss} />
      <View style={dsStyles.sheet}>
        <View style={dsStyles.handleRow}><View style={dsStyles.handle} /></View>
        <View style={dsStyles.iconWrap}>
          <Feather name="check-circle" size={26} color="#009668" />
        </View>
        <Text style={dsStyles.title}>Recording saved to your device</Text>
        <Text style={dsStyles.body}>
          {count > 1
            ? `${count} recording segments were saved to your device's files.`
            : "The recording was saved to your device's files."}
        </Text>
        <Pressable style={dsStyles.doneBtn} onPress={onDismiss}>
          <Text style={dsStyles.doneBtnText}>Done</Text>
        </Pressable>
      </View>
    </View>
  </Modal>
);

const dsStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 24,
    paddingBottom: 28,
    alignItems: 'center',
  },
  handleRow: { alignSelf: 'stretch', alignItems: 'center', marginTop: 10, marginBottom: 6 },
  handle: { width: 32, height: 3, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.1)' },
  iconWrap: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,150,104,0.1)',
    alignItems: 'center', justifyContent: 'center', marginTop: 14, marginBottom: 14,
  },
  title: { fontSize: 17, fontWeight: '800', color: '#191C1E', textAlign: 'center', marginBottom: 8 },
  body: { fontSize: 13, color: '#76777D', textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  doneBtn: { alignSelf: 'stretch', backgroundColor: '#F1F2F4', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  doneBtnText: { fontSize: 15, fontWeight: '700', color: '#45464D' },
});

export default SOSDetailScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F9FB' },
  centerWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 16 },
  backText: { fontSize: fontSizes.body, fontWeight: '700', color: '#0051D5' },
  sub: { fontSize: 13, lineHeight: 19, color: '#76777D' },
  headerRow: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    backgroundColor: '#F7F9FB',
  },
  backIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 40, height: 40 },
  headerTitle: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '900', color: '#191C1E' },
  scrollContent: { paddingHorizontal: 4, paddingTop: 8, gap: 10 },
  summaryCard: {
    marginHorizontal: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C6C6CD',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 12,
    alignItems: 'center',
  },
  sosBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFDAD6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  sosBadgeText: { fontSize: 18, lineHeight: 24, fontWeight: '900', color: '#BA1A1A' },
  summaryTitle: { fontSize: 18, lineHeight: 24, fontWeight: '800', color: '#191C1E' },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, marginBottom: 12 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotResolved: { backgroundColor: '#009668' },
  statusDotCancelled: { backgroundColor: '#76777D' },
  statusDotActive: { backgroundColor: '#BA1A1A' },
  statusLineText: { fontSize: 9, lineHeight: 13, fontWeight: '900', textTransform: 'uppercase' },
  statusLineTextResolved: { color: '#009668' },
  statusLineTextCancelled: { color: '#76777D' },
  statusLineTextActive: { color: '#BA1A1A' },
  summaryDivider: { alignSelf: 'stretch', height: 1, backgroundColor: '#C6C6CD', opacity: 0.5 },
  summaryGrid: { alignSelf: 'stretch', flexDirection: 'row', paddingTop: 12 },
  summaryCol: { flex: 1 },
  summaryColRight: { alignItems: 'flex-end' },
  summaryLabel: { fontSize: 9, lineHeight: 13, fontWeight: '800', color: '#45464D', textTransform: 'uppercase' },
  summaryValue: { marginTop: 2, fontSize: 14, lineHeight: 20, fontWeight: '800', color: '#191C1E' },
  durationValue: { color: '#0051D5' },
  locationCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#C6C6CD',
    backgroundColor: '#FFFFFF',
    marginHorizontal: -4,
  },
  map: { height: 280, width: '100%' },
  mapEmpty: { height: 280, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#ECEEF0' },
  mapEmptyText: { fontSize: 12, color: '#76777D' },
  mapFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  mapFooterCopy: { flex: 1 },
  mapAddress: { fontSize: 12, lineHeight: 17, fontWeight: '900', color: '#191C1E' },
  mapAccuracy: { fontSize: 10, lineHeight: 14, fontWeight: '600', color: '#76777D', marginTop: 1 },
  audioCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C6C6CD',
    backgroundColor: '#FFFFFF',
    padding: 14,
    gap: 12,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, lineHeight: 21, fontWeight: '900', color: '#191C1E' },
  downloadBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingLeft: 8 },
  downloadText: { fontSize: 10, lineHeight: 14, fontWeight: '800', color: '#0051D5' },
  downloadErrorText: { fontSize: 11, lineHeight: 15, fontWeight: '600', color: '#BA1A1A' },
  emptyCardText: { fontSize: 12, lineHeight: 17, color: '#76777D', fontWeight: '600' },
  playerBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F2F4F6', borderRadius: 8, padding: 14 },
  playBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#0051D5', alignItems: 'center', justifyContent: 'center' },
  waveformWrap: { flex: 1 },
  waveform: { height: 38, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  waveformBar: { width: 3, borderRadius: 2, backgroundColor: '#C6C6CD' },
  waveformBarActive: { backgroundColor: '#0051D5' },
  audioTimeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  audioTime: { fontSize: 9, lineHeight: 13, color: '#45464D', fontWeight: '700' },
  contactsCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C6C6CD',
    backgroundColor: '#FFFFFF',
    padding: 14,
    gap: 12,
  },
  contactList: { gap: 12 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  initialAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#DBE1FF', alignItems: 'center', justifyContent: 'center' },
  initialAvatarMuted: { backgroundColor: '#E0E3E5' },
  initialText: { fontSize: 11, lineHeight: 15, fontWeight: '900', color: '#00174B' },
  initialTextMuted: { color: '#45464D' },
  contactCopy: { flex: 1 },
  contactName: { fontSize: 13, lineHeight: 18, fontWeight: '900', color: '#191C1E' },
  contactRole: { fontSize: 10, lineHeight: 14, fontWeight: '600', color: '#45464D' },
  notifyBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  ackBadge: { backgroundColor: 'rgba(0,150,104,0.1)' },
  sentBadge: { backgroundColor: '#E6E8EA' },
  failedBadge: { backgroundColor: 'rgba(186,26,26,0.1)' },
  notifyText: { fontSize: 9, lineHeight: 13, fontWeight: '800' },
  ackText: { color: '#009668' },
  sentText: { color: '#45464D' },
  failedText: { color: '#BA1A1A' },
  metaMiniCard: { borderRadius: 8, borderWidth: 1, borderColor: '#C6C6CD', backgroundColor: '#FFFFFF', padding: 14 },
  miniLabel: { fontSize: 10, lineHeight: 14, fontWeight: '900', color: '#45464D', textTransform: 'uppercase', marginBottom: 7 },
  miniValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  miniValue: { fontSize: 15, lineHeight: 21, fontWeight: '900', color: '#191C1E' },
  tripLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, borderWidth: 1, borderColor: '#C6C6CD', backgroundColor: '#FFFFFF', padding: 14 },
  tripLinkText: { flex: 1, fontSize: 13, fontWeight: '800', color: '#0051D5' },
  reportButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(186,26,26,0.24)',
    backgroundColor: '#FFFFFF',
    paddingVertical: 15,
    alignItems: 'center',
  },
  reportButtonText: { fontSize: 13, lineHeight: 18, fontWeight: '900', color: '#BA1A1A' },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: '#E8EEFF',
    borderTopWidth: 1,
    borderTopColor: '#D6DCEF',
    paddingTop: 9,
    paddingHorizontal: 4,
  },
  navItem: { flex: 1, alignItems: 'center', gap: 3 },
  navText: { fontSize: 9, lineHeight: 13, fontWeight: '700', color: '#45464D' },
  navTextActive: { color: '#4B0082', fontWeight: '900' },
});

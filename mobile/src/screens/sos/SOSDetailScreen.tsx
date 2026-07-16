import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Audio, AVPlaybackStatus } from 'expo-av';
import MapView, { Marker } from 'react-native-maps';
import { AppStackParamList } from '../../navigation/AppNavigator';
import { supabase } from '../../lib/supabase';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { SOSEvent } from '../routes/RoutesScreen';

// ── Types ─────────────────────────────────────────────────────────────────────

type SOSDetailRoute = RouteProp<AppStackParamList, 'SOSDetail'>;
type Nav = NativeStackNavigationProp<AppStackParamList>;

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

// ── Component ─────────────────────────────────────────────────────────────────

const SOSDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<SOSDetailRoute>();
  const { sosId } = route.params;

  const [sos, setSos] = useState<SOSEvent | null>(null);
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [contactNames, setContactNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [audioPaths, setAudioPaths] = useState<string[]>([]);
  const [audioDeleted, setAudioDeleted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const soundRef = useRef<Audio.Sound | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data: sosRow } = await supabase.from('sos_events').select('*').eq('id', sosId).single();
    const event = (sosRow as SOSEvent) ?? null;
    setSos(event);

    if (event) {
      const [{ data: geoRows }, { data: files }] = await Promise.all([
        supabase.rpc('get_sos_event_geo', { p_sos_id: sosId }),
        supabase.storage.from('sos-audio').list(sosId),
      ]);

      const geoRow = (geoRows as Array<{ lat: number; lng: number }> | null)?.[0];
      setGeo(geoRow ?? null);

      const chunkNames = (files ?? [])
        .map((f) => f.name)
        .filter((n) => n.endsWith('.m4a'));
      setAudioPaths(sortAudioFilenames(chunkNames).map((n) => `${sosId}/${n}`));

      if (event.notified_contact_ids.length > 0) {
        const { data: contacts } = await supabase
          .from('trusted_contacts')
          .select('id, name')
          .in('id', event.notified_contact_ids);
        setContactNames(((contacts as Array<{ name: string }> | null) ?? []).map((c) => c.name));
      } else {
        setContactNames([]);
      }
    }

    setLoading(false);
  }, [sosId]);

  useEffect(() => {
    load();
  }, [load]);

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
    if (audioPaths.length === 0) return;
    void (async () => {
      const { data } = await supabase.storage.from('sos-audio').createSignedUrl(audioPaths[0], 300);
      if (data?.signedUrl) {
        await Linking.openURL(data.signedUrl).catch(() => null);
      }
    })();
  }, [audioPaths]);

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
  const openMap = () => {
    if (!geo) return;
    void Linking.openURL(`https://maps.google.com/?q=${geo.lat},${geo.lng}`).catch(() => null);
  };

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
              initialRegion={{ latitude: geo.lat, longitude: geo.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
              mapType="satellite"
              scrollEnabled={false}
              zoomEnabled={false}
              pitchEnabled={false}
              rotateEnabled={false}
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
            <Pressable style={[styles.mapButton, !geo && styles.mapButtonDisabled]} onPress={openMap} disabled={!geo}>
              <Text style={styles.mapButtonText}>View on Map</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.audioCard}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardTitleRow}>
              <Feather name="mic" size={15} color="#0051D5" />
              <Text style={styles.cardTitle}>Incident Recording</Text>
            </View>
            {audioPaths.length > 0 && !audioDeleted ? (
              <Pressable style={styles.downloadBtn} onPress={handleDownloadPress}>
                <Feather name="download" size={10} color="#0051D5" />
                <Text style={styles.downloadText}>Download</Text>
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
        </View>

        <View style={styles.contactsCard}>
          <View style={styles.cardTitleRow}>
            <Feather name="users" size={15} color="#0051D5" />
            <Text style={styles.cardTitle}>Safety Circle Notified</Text>
          </View>
          {contactNames.length === 0 ? (
            <Text style={styles.emptyCardText}>No contacts were notified for this alert.</Text>
          ) : (
            <View style={styles.contactList}>
              {contactNames.map((name, index) => (
                <View key={`${name}-${index}`} style={styles.contactRow}>
                  <View style={[styles.initialAvatar, index > 0 && styles.initialAvatarMuted]}>
                    <Text style={[styles.initialText, index > 0 && styles.initialTextMuted]}>{initials(name)}</Text>
                  </View>
                  <View style={styles.contactCopy}>
                    <Text style={styles.contactName}>{name}</Text>
                    <Text style={styles.contactRole}>{index === 0 ? 'Primary Contact' : 'Family Member'}</Text>
                  </View>
                  <View style={[styles.notifyBadge, index === 0 ? styles.ackBadge : styles.sentBadge]}>
                    <Feather name={index === 0 ? 'check-circle' : 'mail'} size={10} color={index === 0 ? '#009668' : '#45464D'} />
                    <Text style={[styles.notifyText, index === 0 ? styles.ackText : styles.sentText]}>
                      {index === 0 ? 'Acknowledged' : 'Notified'}
                    </Text>
                  </View>
                </View>
              ))}
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
    </View>
  );
};

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
  },
  map: { height: 160, width: '100%' },
  mapEmpty: { height: 160, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#ECEEF0' },
  mapEmptyText: { fontSize: 12, color: '#76777D' },
  mapFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  mapFooterCopy: { flex: 1 },
  mapAddress: { fontSize: 12, lineHeight: 17, fontWeight: '900', color: '#191C1E' },
  mapAccuracy: { fontSize: 10, lineHeight: 14, fontWeight: '600', color: '#76777D', marginTop: 1 },
  mapButton: { backgroundColor: '#316BF3', borderRadius: 20, paddingHorizontal: 13, paddingVertical: 8 },
  mapButtonDisabled: { opacity: 0.45 },
  mapButtonText: { fontSize: 10, lineHeight: 14, fontWeight: '900', color: '#FFFFFF' },
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
  notifyText: { fontSize: 9, lineHeight: 13, fontWeight: '800' },
  ackText: { color: '#009668' },
  sentText: { color: '#45464D' },
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

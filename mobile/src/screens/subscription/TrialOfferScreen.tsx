import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AppStackParamList } from '../../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<AppStackParamList, 'TrialOffer'>;
};

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

const TIMELINE = [
  { day: 'Today — Day 1', desc: 'Full access, no charge', filled: true },
  { day: 'Day 6 — Reminder', desc: "We'll remind you before the trial ends", filled: false },
  { day: 'Day 9 — ₦35,000 charged', desc: 'Renews yearly unless cancelled', filled: false },
];

const TrialOfferScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const handleStartTrial = async () => {
    setLoading(true);
    setServerError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setServerError('Session expired. Please sign in again.');
        setLoading(false);
        return;
      }

      const res = await fetch(`${BACKEND_URL}/api/v1/payments/trial/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json() as { success?: boolean; error?: string };

      if (!res.ok || !data.success) {
        setServerError(data.error ?? 'Could not start trial. Please try again.');
        setLoading(false);
        return;
      }

      navigation.navigate('Success', { type: 'trial' });
    } catch {
      setServerError('Could not start trial. Please try again.');
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Green header ── */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Pressable style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={12}>
            <Feather name="arrow-left" size={18} color="rgba(255,255,255,0.6)" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.offerBadge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>One-time offer</Text>
          </View>
          <Text style={styles.headline}>Try Hadin free{'\n'}for 8 days.</Text>
          <Text style={styles.headerSub}>
            No charge for 8 days. Start protecting yourself today.
          </Text>
        </View>

        {/* ── Body ── */}
        <View style={styles.body}>
          {/* Error banner */}
          {serverError ? (
            <View style={styles.errorBanner}>
              <Feather name="alert-circle" size={14} color={colors.brand.sos} />
              <Text style={styles.errorBannerText}>{serverError}</Text>
            </View>
          ) : null}

          {/* Timeline */}
          <View style={styles.card}>
            {TIMELINE.map((item, i) => (
              <View key={item.day} style={styles.timelineRow}>
                <View style={styles.timelineDotCol}>
                  <View style={[styles.timelineDot, item.filled && styles.timelineDotFilled]} />
                  {i < TIMELINE.length - 1 && <View style={styles.timelineLine} />}
                </View>
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineDay}>{item.day}</Text>
                  <Text style={styles.timelineDesc}>{item.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* What you get */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Full access includes</Text>
            {[
              'SOS Trigger with circle alerts',
              'Live location sharing',
              '24/7 AI monitoring',
              'Family circle up to 5 contacts',
              'Priority emergency response',
            ].map((feat) => (
              <View key={feat} style={styles.featRow}>
                <Feather name="check" size={14} color={colors.brand.primary} />
                <Text style={styles.featText}>{feat}</Text>
              </View>
            ))}
          </View>

          {/* Security note */}
          <View style={styles.secureRow}>
            <Feather name="lock" size={13} color={colors.brand.textSecondary} />
            <Text style={styles.secureText}>No card required · Cancel anytime</Text>
          </View>

          {/* Trial button */}
          <Pressable
            style={({ pressed }) => [styles.trialBtn, loading && styles.trialBtnDisabled, pressed && !loading && styles.pressed]}
            onPress={handleStartTrial}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <>
                <Text style={styles.trialBtnText}>Start free trial</Text>
                <Text style={styles.trialBtnSub}>No charge for 8 days · ₦35,000/yr from day 9</Text>
              </>
            )}
          </Pressable>

          <Text style={styles.legal}>
            Full access for 8 days, no payment required. After 8 days you'll be prompted to subscribe.
            By continuing you agree to Hadin's{' '}
            <Text style={styles.legalLink}>Terms</Text>.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand.bgSurface },
  scroll: { flexGrow: 1, paddingBottom: spacing.gap32 },

  header: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.gap20,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 12 },
  backText: { fontSize: fontSizes.caption, color: 'rgba(255,255,255,0.6)' },
  offerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ADE80' },
  badgeText: { fontSize: 10, color: 'rgba(255,255,255,0.9)', fontWeight: '600' },
  headline: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -0.4,
    lineHeight: 30,
    marginBottom: 6,
  },
  headerSub: {
    fontSize: fontSizes.caption,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 20,
  },

  body: { padding: spacing.screenPadding, gap: spacing.gap12 },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 12,
  },
  errorBannerText: { flex: 1, color: colors.brand.sos, fontSize: fontSizes.caption, lineHeight: 18 },

  card: {
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: spacing.cardPadding,
    borderWidth: 0.5,
    borderColor: '#EEECe6',
  },
  cardTitle: {
    fontSize: fontSizes.caption,
    fontWeight: '700',
    color: colors.brand.textPrimary,
    marginBottom: 10,
  },

  timelineRow: { flexDirection: 'row', gap: 10, paddingBottom: 6 },
  timelineDotCol: { alignItems: 'center', width: 10, flexShrink: 0 },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.brand.primary,
    backgroundColor: colors.white,
  },
  timelineDotFilled: { backgroundColor: colors.brand.primary },
  timelineLine: { width: 1.5, flex: 1, backgroundColor: '#EEECe6', marginVertical: 3 },
  timelineContent: { flex: 1, paddingBottom: 10 },
  timelineDay: { fontSize: fontSizes.caption, fontWeight: '700', color: colors.brand.primary },
  timelineDesc: { fontSize: 10, color: colors.brand.textSecondary, marginTop: 2 },

  featRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  featText: { fontSize: fontSizes.caption, color: colors.brand.textPrimary, flex: 1 },

  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  secureText: { fontSize: 10, color: colors.brand.textSecondary },

  trialBtn: {
    backgroundColor: colors.brand.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  trialBtnDisabled: { opacity: 0.6 },
  trialBtnText: { fontSize: fontSizes.body, fontWeight: '700', color: colors.white },
  trialBtnSub: { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 3 },
  pressed: { opacity: 0.8 },

  legal: { fontSize: 10, color: '#B4B2A9', textAlign: 'center', lineHeight: 16 },
  legalLink: { color: colors.brand.primary },
});

export default TrialOfferScreen;

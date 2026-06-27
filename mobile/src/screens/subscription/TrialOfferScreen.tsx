import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

const TIMELINE = [
  { day: 'Today — Day 1', desc: 'Full access, no charge', filled: true },
  { day: 'Day 3 — Reminder', desc: 'We\'ll remind you before trial ends', filled: false },
  { day: 'Day 4 — $25 charged', desc: 'Renews yearly unless cancelled', filled: false },
];

const TrialOfferScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();

  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [loading, setLoading] = useState(false);

  const formatCardNumber = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(.{4})/g, '$1 ').trim();
  };

  const formatExpiry = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 4);
    if (digits.length >= 3) return `${digits.slice(0, 2)} / ${digits.slice(2)}`;
    return digits;
  };

  const handleStartTrial = async () => {
    setLoading(true);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const trialStart = new Date().toISOString();
      const trialEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          subscription_status: 'trial',
          trial_start: trialStart,
          trial_end: trialEnd,
        }, { onConflict: 'id' });
    }

    setLoading(false);
    navigation.navigate('Success', { type: 'trial' });
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
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
          <Text style={styles.headline}>Try Hadin free{'\n'}for 3 days.</Text>
          <Text style={styles.headerSub}>
            No charge until day 4. Cancel before then and pay nothing.
          </Text>
        </View>

        {/* ── Body ── */}
        <View style={styles.body}>
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

          {/* Card form */}
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Card number</Text>
            <View style={styles.fieldInput}>
              <TextInput
                style={styles.textInput}
                value={cardNumber}
                onChangeText={(v) => setCardNumber(formatCardNumber(v))}
                placeholder="•••• •••• •••• ••••"
                placeholderTextColor="#C5C3BB"
                keyboardType="number-pad"
                returnKeyType="next"
                editable={!loading}
              />
            </View>
            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Expiry</Text>
                <View style={styles.fieldInput}>
                  <TextInput
                    style={styles.textInput}
                    value={expiry}
                    onChangeText={(v) => setExpiry(formatExpiry(v))}
                    placeholder="MM / YY"
                    placeholderTextColor="#C5C3BB"
                    keyboardType="number-pad"
                    returnKeyType="next"
                    editable={!loading}
                  />
                </View>
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>CVV</Text>
                <View style={styles.fieldInput}>
                  <TextInput
                    style={styles.textInput}
                    value={cvv}
                    onChangeText={(v) => setCvv(v.replace(/\D/g, '').slice(0, 4))}
                    placeholder="•••"
                    placeholderTextColor="#C5C3BB"
                    keyboardType="number-pad"
                    secureTextEntry
                    editable={!loading}
                  />
                </View>
              </View>
            </View>
          </View>

          {/* Security */}
          <View style={styles.secureRow}>
            <Feather name="lock" size={13} color={colors.brand.textSecondary} />
            <Text style={styles.secureText}>Secured by Paystack</Text>
          </View>

          {/* Trial button */}
          <Pressable
            style={({ pressed }) => [styles.trialBtn, pressed && !loading && styles.pressed]}
            onPress={handleStartTrial}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <>
                <Text style={styles.trialBtnText}>Start free trial</Text>
                <Text style={styles.trialBtnSub}>No charge today · $25/yr from day 4</Text>
              </>
            )}
          </Pressable>

          <Text style={styles.legal}>
            Cancel before day 4 to pay nothing. By continuing you agree to Hadin's{' '}
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

  card: {
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: spacing.cardPadding,
    borderWidth: 0.5,
    borderColor: '#EEECe6',
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

  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.brand.textSecondary,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  fieldInput: {
    backgroundColor: '#F4F3EF',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 0.5,
    borderColor: '#EEECe6',
    marginBottom: 10,
  },
  textInput: { fontSize: fontSizes.caption, color: colors.brand.textPrimary },
  fieldRow: { flexDirection: 'row', gap: 8 },
  fieldHalf: { flex: 1 },

  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  secureText: { fontSize: 10, color: colors.brand.textSecondary },

  trialBtn: {
    backgroundColor: colors.brand.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  trialBtnText: { fontSize: fontSizes.body, fontWeight: '700', color: colors.white },
  trialBtnSub: { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 3 },
  pressed: { opacity: 0.8 },

  legal: { fontSize: 10, color: '#B4B2A9', textAlign: 'center', lineHeight: 16 },
  legalLink: { color: colors.brand.primary },
});

export default TrialOfferScreen;

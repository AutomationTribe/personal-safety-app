import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AppStackParamList } from '../../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<AppStackParamList, 'Subscription'>;
};

const EXIT_INTERCEPT_KEY = 'hadin_exit_intercept_shown';

const FEATURES: string[] = [
  'Instant SOS alerts to your circle',
  'SMS fallback — works without internet',
  'Trip check-ins and departure alerts',
  'Unlimited circle members',
  'Emergency contact notifications on SOS',
];

const SubscriptionScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const [showExitSheet, setShowExitSheet] = useState(false);
  const interceptShownRef = useRef(false);

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (interceptShownRef.current) {
        BackHandler.exitApp();
        return true;
      }

      void AsyncStorage.getItem(EXIT_INTERCEPT_KEY).then((val) => {
        if (val) {
          BackHandler.exitApp();
        } else {
          void AsyncStorage.setItem(EXIT_INTERCEPT_KEY, 'true');
          interceptShownRef.current = true;
          setShowExitSheet(true);
        }
      });

      return true;
    });

    return () => handler.remove();
  }, []);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Green header ── */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.eyebrow}>HADIN PRO</Text>
          <Text style={styles.headline}>Peace of mind,{'\n'}always on.</Text>
          <Text style={styles.headerSub}>
            Keep your circle close and your location safe, every day.
          </Text>
        </View>

        {/* ── Body ── */}
        <View style={styles.body}>
          {/* Plan card */}
          <View style={styles.planCard}>
            <View style={styles.planTop}>
              <Text style={styles.planName}>Hadin Pro</Text>
              <View style={styles.priceRow}>
                <Text style={styles.price}>$25</Text>
                <Text style={styles.pricePer}>/year</Text>
              </View>
            </View>
            <View style={styles.divider} />
            {FEATURES.map((feat) => (
              <View key={feat} style={styles.featRow}>
                <View style={styles.featIcon}>
                  <Feather name="check" size={10} color={colors.brand.primary} />
                </View>
                <Text style={styles.featText}>{feat}</Text>
              </View>
            ))}
          </View>

          {/* Subscribe */}
          <Pressable
            style={({ pressed }) => [styles.subscribeBtn, pressed && styles.pressed]}
            onPress={() => navigation.navigate('DirectPayment')}
          >
            <Text style={styles.subscribeBtnText}>Subscribe — $25/year</Text>
          </Pressable>

          {/* No thanks */}
          <Pressable
            style={({ pressed }) => [styles.noThanksBtn, pressed && styles.pressed]}
            onPress={() => navigation.navigate('TrialOffer')}
          >
            <Text style={styles.noThanksBtnText}>No thanks</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* ── Exit intercept sheet ── */}
      <Modal
        visible={showExitSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowExitSheet(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetIcon}>
              <Feather name="shield" size={26} color={colors.brand.primary} />
            </View>
            <Text style={styles.sheetTitle}>Before you go…</Text>
            <Text style={styles.sheetSub}>
              Your circle can't protect you if they can't find you. Try Hadin free — no charge for 3 days.
            </Text>
            <View style={styles.offerStrip}>
              <View style={styles.offerBadge}>
                <Text style={styles.offerBadgeText}>ONE-TIME OFFER</Text>
              </View>
              <Text style={styles.offerTitle}>3 Days Free</Text>
              <Text style={styles.offerSub}>Full access · No charge today · $25/yr after</Text>
            </View>
            <View style={styles.sheetBtns}>
              <Pressable
                style={({ pressed }) => [styles.acceptBtn, pressed && styles.pressed]}
                onPress={() => {
                  setShowExitSheet(false);
                  navigation.navigate('TrialOffer');
                }}
              >
                <Text style={styles.acceptBtnText}>Try free for 3 days</Text>
                <Text style={styles.acceptBtnSub}>Card required · Auto-renews at $25/year</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.declineBtn, pressed && styles.pressed]}
                onPress={() => {
                  setShowExitSheet(false);
                  BackHandler.exitApp();
                }}
              >
                <Text style={styles.declineBtnText}>No thanks, close app</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand.bgSurface },
  scroll: { flexGrow: 1, paddingBottom: spacing.gap32 },

  header: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.gap24,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  headline: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -0.5,
    lineHeight: 32,
    marginBottom: spacing.gap8,
  },
  headerSub: {
    fontSize: fontSizes.caption,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 20,
  },

  body: {
    flex: 1,
    padding: spacing.screenPadding,
    gap: spacing.gap12,
  },

  planCard: {
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: spacing.cardPadding,
    borderWidth: 0.5,
    borderColor: '#EEECe6',
    marginBottom: spacing.gap8,
  },
  planTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  planName: {
    fontSize: fontSizes.body,
    fontWeight: '700',
    color: colors.brand.textPrimary,
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  price: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.brand.primary,
    letterSpacing: -0.5,
  },
  pricePer: {
    fontSize: fontSizes.small,
    fontWeight: '500',
    color: colors.brand.textSecondary,
  },
  divider: { height: 0.5, backgroundColor: '#F4F3EF', marginBottom: 10 },
  featRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  featIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.brand.light,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  featText: { fontSize: fontSizes.caption, color: colors.brand.textPrimary, flex: 1 },

  subscribeBtn: {
    backgroundColor: colors.brand.primary,
    borderRadius: 13,
    paddingVertical: 15,
    alignItems: 'center',
  },
  subscribeBtnText: { fontSize: fontSizes.body, fontWeight: '700', color: colors.white },

  noThanksBtn: {
    backgroundColor: colors.white,
    borderRadius: 13,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#EEECe6',
  },
  noThanksBtnText: { fontSize: fontSizes.body, fontWeight: '500', color: colors.brand.textSecondary },

  pressed: { opacity: 0.8 },

  // Exit intercept
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 32,
  },
  sheetHandle: {
    width: 30,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
  },
  sheetIcon: {
    width: 52,
    height: 52,
    backgroundColor: colors.brand.light,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 16,
    marginBottom: 10,
  },
  sheetTitle: {
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: colors.brand.textPrimary,
    marginBottom: 6,
  },
  sheetSub: {
    textAlign: 'center',
    fontSize: fontSizes.caption,
    color: colors.brand.textSecondary,
    lineHeight: 20,
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  offerStrip: {
    marginHorizontal: 16,
    marginBottom: 14,
    backgroundColor: colors.brand.light,
    borderRadius: 12,
    padding: 12,
    borderWidth: 0.5,
    borderColor: '#C6E8D5',
    alignItems: 'center',
  },
  offerBadge: {
    backgroundColor: colors.brand.primary,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginBottom: 5,
  },
  offerBadgeText: { fontSize: 9, fontWeight: '700', color: colors.white, letterSpacing: 0.5 },
  offerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.brand.primary,
    marginBottom: 2,
  },
  offerSub: { fontSize: 10, color: '#0F6E56' },

  sheetBtns: { paddingHorizontal: 16, gap: 8 },
  acceptBtn: {
    backgroundColor: colors.brand.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  acceptBtnText: { fontSize: fontSizes.body, fontWeight: '700', color: colors.white },
  acceptBtnSub: { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  declineBtn: {
    backgroundColor: '#F4F3EF',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  declineBtnText: { fontSize: fontSizes.body, fontWeight: '500', color: colors.brand.textSecondary },
});

export default SubscriptionScreen;

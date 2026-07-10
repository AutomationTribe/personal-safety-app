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
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AppStackParamList } from '../../navigation/AppNavigator';
import HadinLogo from '../../components/HadinLogo';

type Props = {
  navigation: NativeStackNavigationProp<AppStackParamList, 'Subscription'>;
};

type ModalTrigger = 'logout' | 'back' | 'tab';

const BASIC_FEATURES = [
  'SOS Trigger',
  'Live Location Sharing',
  '1 Emergency Contact',
];

const ELITE_FEATURES = [
  '24/7 AI Monitoring',
  'Family Circle (up to 5)',
  'Priority Emergency Response',
  'Safety Insights',
];

const SubscriptionScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const [modalTrigger, setModalTrigger] = useState<ModalTrigger | null>(null);
  const interceptShownRef = useRef(false);

  const showTrialModal = (trigger: ModalTrigger) => {
    setModalTrigger(trigger);
  };

  const hideModal = () => setModalTrigger(null);

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (interceptShownRef.current) {
        BackHandler.exitApp();
        return true;
      }
      interceptShownRef.current = true;
      showTrialModal('back');
      return true;
    });
    return () => handler.remove();
  }, []);

  const handleDecline = async () => {
    hideModal();
    if (modalTrigger === 'logout') {
      await supabase.auth.signOut().catch(() => null);
    } else if (modalTrigger === 'back') {
      BackHandler.exitApp();
    }
    // 'tab' trigger: just dismiss — stay on screen
  };

  const handleAcceptTrial = () => {
    hideModal();
    navigation.navigate('TrialOffer');
  };

  const handleTabPress = (screen: keyof AppStackParamList) => {
    if (screen === 'Home' || screen === 'Routes' || screen === 'Circle') {
      showTrialModal('tab');
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top + 4 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [styles.topIconBtn, pressed && styles.pressed]}
          onPress={() => showTrialModal('back')}
        >
          <Feather name="arrow-left" size={18} color={colors.brand.textPrimary} />
        </Pressable>
        <HadinLogo size={22} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 14 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contentColumn}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.headline}>Choose Your Protection</Text>
          <Text style={styles.headerSub}>
            Advanced safety solutions tailored to your lifestyle.
            {'\n'}Stay protected wherever you go.
          </Text>
        </View>

        {/* ── Basic plan card ── */}
        <View style={styles.basicCard}>
          <Text style={styles.planLabel}>STANDARD</Text>
          <View style={styles.planTitleRow}>
            <Text style={styles.planTitle}>Essential Safety</Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.price}>₦20,000</Text>
            <Text style={styles.pricePer}>/yr</Text>
          </View>
          <View style={styles.divider} />
          {BASIC_FEATURES.map((feat) => (
            <View key={feat} style={styles.featRow}>
              <Feather name="check-circle" size={14} color={colors.brand.primary} />
              <Text style={styles.featTextDark}>{feat}</Text>
            </View>
          ))}
          <Pressable
            style={({ pressed }) => [styles.basicBtn, pressed && styles.pressed]}
            onPress={() => navigation.navigate('DirectPayment', { plan: 'basic' })}
          >
            <Text style={styles.basicBtnText}>Select Basic Plan</Text>
          </Pressable>
        </View>

        {/* ── Elite plan card ── */}
        <View style={styles.eliteCard}>
          <View style={styles.eliteTopRow}>
            <Text style={styles.elitePlanLabel}>PREMIUM PROTECTION</Text>
            <View style={styles.recommendedBadge}>
              <Text style={styles.recommendedText}>RECOMMENDED</Text>
            </View>
          </View>
          <View style={styles.eliteTitleRow}>
            <Text style={styles.eliteTitle}>Complete Peace of Mind</Text>
          </View>
          <View style={styles.elitePriceRow}>
            <Text style={styles.elitePrice}>₦35,000</Text>
            <Text style={styles.elitePricePer}>/yr</Text>
          </View>
          <Text style={styles.eliteEverything}>Everything in Basic, also:</Text>
          {ELITE_FEATURES.map((feat) => (
            <View key={feat} style={styles.featRow}>
              <Feather name="check-circle" size={14} color="#4ADE80" />
              <Text style={styles.featTextLight}>{feat}</Text>
            </View>
          ))}
          <Pressable
            style={({ pressed }) => [styles.eliteBtn, pressed && styles.pressed]}
            onPress={() => navigation.navigate('DirectPayment', { plan: 'elite' })}
          >
            <Text style={styles.eliteBtnText}>Select Elite Plan →</Text>
          </Pressable>
        </View>

        {/* ── Log out link ── */}
        <Pressable
          style={({ pressed }) => [styles.logoutLink, pressed && styles.pressed]}
          onPress={() => showTrialModal('logout')}
        >
          <Feather name="log-out" size={13} color="#DC2626" />
          <Text style={styles.logoutLinkText}>LOG OUT</Text>
        </Pressable>
        </View>
      </ScrollView>

      {/* ── Bottom tab bar ── */}
      <View style={[styles.tabBar, { paddingBottom: insets.bottom || spacing.gap8 }]}>
        <TabItem icon="grid" label="Dashboard" onPress={() => handleTabPress('Home')} />
        <TabItem icon="users" label="Circle" onPress={() => handleTabPress('Circle')} />
        <TabItem icon="clock" label="History" onPress={() => handleTabPress('Routes')} />
        <TabItem icon="user" label="Profile" active />
      </View>

      {/* ── Trial offer modal ── */}
      <Modal
        visible={modalTrigger !== null}
        transparent
        animationType="fade"
        onRequestClose={hideModal}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetIcon}>
              <Feather name="gift" size={24} color="#0B5FE8" />
            </View>
            <Text style={styles.sheetTitle}>Try Hadin for Free</Text>
            <Text style={styles.sheetSub}>
              Get 7 days of Elite protection on us. No commitment required.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.acceptBtn, pressed && styles.pressed]}
              onPress={handleAcceptTrial}
            >
              <Text style={styles.acceptBtnText}>Start 7-Day Free Trial</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.declineBtn, pressed && styles.pressed]}
              onPress={handleDecline}
            >
              <Text style={styles.declineBtnText}>
                {modalTrigger === 'logout' ? 'LOG OUT' : 'No thanks'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ── Tab item ─────────────────────────────────────────────────────────────────

interface TabItemProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  active?: boolean;
  onPress?: () => void;
}

const TabItem = ({ icon, label, active = false, onPress }: TabItemProps) => (
  <Pressable style={styles.tabItem} onPress={onPress} disabled={active}>
    <Feather
      name={icon}
      size={22}
      color={active ? '#111827' : '#111827'}
    />
    {active && <View style={styles.tabActiveLine} />}
    <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
  </Pressable>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F6F8' },

  topBar: {
    height: 50,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F5F6F8',
  },
  topIconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  contentColumn: {
    width: '100%',
    maxWidth: 320,
    gap: 12,
  },

  header: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  headline: {
    fontSize: 21,
    fontWeight: '800',
    color: colors.brand.textPrimary,
    marginBottom: 6,
  },
  headerSub: {
    maxWidth: 260,
    textAlign: 'center',
    fontSize: 10,
    color: '#4B5563',
    lineHeight: 14,
  },

  // Basic card
  basicCard: {
    backgroundColor: colors.white,
    borderRadius: 8,
    padding: 18,
    borderWidth: 1,
    borderColor: '#D7DAE0',
  },
  planLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: '#8A8F98',
    letterSpacing: 0,
    marginBottom: 7,
  },
  planTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.brand.textPrimary,
    flex: 1,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginBottom: 14,
  },
  price: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
  },
  pricePer: { fontSize: 11, color: '#4B5563', fontWeight: '600' },
  divider: { height: 0 },
  featRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  featTextDark: { fontSize: 10, color: '#111827', flex: 1 },
  basicBtn: {
    marginTop: 14,
    backgroundColor: '#E5E7EB',
    borderRadius: 5,
    paddingVertical: 12,
    alignItems: 'center',
  },
  basicBtnText: { fontSize: 10, fontWeight: '800', color: '#111827' },

  // Elite card
  eliteCard: {
    backgroundColor: '#0B1026',
    borderRadius: 8,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  eliteTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  elitePlanLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.72)',
    letterSpacing: 0,
  },
  recommendedBadge: {
    backgroundColor: '#5B21B6',
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  recommendedText: { fontSize: 7, fontWeight: '800', color: '#fff', letterSpacing: 0 },
  eliteTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  eliteTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#fff',
    flex: 1,
    lineHeight: 22,
  },
  elitePriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginBottom: 18,
  },
  elitePrice: { fontSize: 28, fontWeight: '800', color: '#fff' },
  elitePricePer: { fontSize: 11, color: 'rgba(255,255,255,0.68)', fontWeight: '600' },
  eliteEverything: {
    fontSize: 10,
    color: '#fff',
    marginBottom: 4,
    fontWeight: '700',
  },
  featTextLight: { fontSize: 10, color: 'rgba(255,255,255,0.88)', flex: 1 },
  eliteBtn: {
    marginTop: 16,
    backgroundColor: '#5B21D9',
    borderRadius: 5,
    paddingVertical: 13,
    alignItems: 'center',
  },
  eliteBtnText: { fontSize: 10, fontWeight: '800', color: '#fff' },

  // Log out link
  logoutLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'center',
    minWidth: 112,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 18,
    borderWidth: 2,
    borderColor: '#DC2626',
    borderRadius: 5,
  },
  logoutLinkText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#DC2626',
    letterSpacing: 0,
  },

  pressed: { opacity: 0.8 },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 7,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 2 },
  tabActiveLine: {
    width: 0,
    height: 0,
  },
  tabLabel: { fontSize: 9, color: '#111827' },
  tabLabelActive: { color: '#111827', fontWeight: '800' },

  // Trial offer modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  sheet: {
    backgroundColor: colors.white,
    borderRadius: 8,
    paddingHorizontal: 36,
    paddingTop: 34,
    paddingBottom: 30,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
  },
  sheetIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E4E8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  sheetTitle: {
    textAlign: 'center',
    fontSize: 21,
    fontWeight: '800',
    color: colors.brand.textPrimary,
    marginBottom: 8,
  },
  sheetSub: {
    textAlign: 'center',
    fontSize: 12,
    color: '#4B5563',
    lineHeight: 16,
    marginBottom: 28,
  },
  acceptBtn: {
    width: '100%',
    backgroundColor: '#075FE4',
    borderRadius: 7,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#075FE4',
    shadowOpacity: 0.28,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  acceptBtnText: { fontSize: 12, fontWeight: '800', color: colors.white },
  declineBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  declineBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#374151',
  },
});

export default SubscriptionScreen;

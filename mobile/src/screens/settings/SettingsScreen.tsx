import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import { stopTracking, flushQueue } from '../../services/LocationService';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AppStackParamList } from '../../navigation/AppNavigator';

// ── Types ─────────────────────────────────────────────────────────────────────

type Nav = NativeStackNavigationProp<AppStackParamList>;

interface ProfileData {
  name: string;
  email: string;
  subscriptionStatus: string;
  plan: string;
  trialEnd: string | null;
  nextBillingDate: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function planBadgeLabel(plan: string): string {
  if (plan === 'elite') return 'ELITE PLAN';
  if (plan === 'basic') return 'BASIC PLAN';
  return 'TRIAL';
}

// ── SettingsScreen ────────────────────────────────────────────────────────────

const SettingsScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [profile, setProfile] = useState<ProfileData>({
    name: '',
    email: '',
    subscriptionStatus: 'free',
    plan: 'free',
    trialEnd: null,
    nextBillingDate: null,
  });
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // ── Load profile ─────────────────────────────────────────────────────────

  const loadProfile = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const meta = user.user_metadata as { full_name?: string } | undefined;
      const name = meta?.full_name ?? '';
      const email = user.email ?? '';

      const { data } = await supabase
        .from('profiles')
        .select('subscription_status, plan, trial_end, next_billing_date')
        .eq('id', user.id)
        .single();

      type Row = {
        subscription_status: string;
        plan: string | null;
        trial_end: string | null;
        next_billing_date: string | null;
      };
      const row = data as Row | null;

      setProfile({
        name,
        email,
        subscriptionStatus: row?.subscription_status ?? 'free',
        plan: row?.plan ?? 'free',
        trialEnd: row?.trial_end ?? null,
        nextBillingDate: row?.next_billing_date ?? null,
      });
    } catch {
      // Non-fatal — show defaults
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // ── Logout ────────────────────────────────────────────────────────────────

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await stopTracking().catch((e) => console.warn('[Settings] stopTracking error:', e));
      await flushQueue().catch((e) => console.warn('[Settings] flushQueue error:', e));
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[Settings] signOut error:', e);
    } finally {
      await AsyncStorage.clear().catch((e) => console.warn('[Settings] AsyncStorage.clear error:', e));
      setLoggingOut(false);
    }
  };

  // ── Derived display values ────────────────────────────────────────────────

  const displayName = profile.name || 'Traveller';
  const isActive = profile.subscriptionStatus === 'active';
  const isTrial = profile.subscriptionStatus === 'trial';
  const hasSubscription = isActive || isTrial;

  const billingLabel = isTrial
    ? `Trial ends ${formatDate(profile.trialEnd)}`
    : `Next Billing: ${formatDate(profile.nextBillingDate)}`;

  const planPrice = profile.plan === 'basic' ? '₦20,000/yr' : '₦35,000/yr';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Page title ── */}
        <View style={[styles.pageHeader, { paddingTop: insets.top + 10 }]}>
          <Text style={styles.pageTitle}>Profile</Text>
        </View>

        {/* ── Subscription card ── */}
        {hasSubscription ? (
          <View style={styles.subCard}>
            <View style={styles.subCardTop}>
              <View>
                <View style={styles.planBadge}>
                  <Text style={styles.planBadgeText}>{planBadgeLabel(profile.plan)}</Text>
                </View>
                <Text style={styles.subCardTitle}>
                  {isTrial ? 'Trial Active' : 'Active Protection'}
                </Text>
                <Text style={styles.subCardPrice}>{planPrice}</Text>
              </View>
              <View style={styles.subCardShield}>
                <Feather name="shield" size={28} color="rgba(255,255,255,0.2)" />
              </View>
            </View>
            <View style={styles.subCardDivider} />
            <Pressable
              style={styles.subCardBottom}
              onPress={() => navigation.navigate('Subscription')}
            >
              <Feather name="calendar" size={13} color="rgba(255,255,255,0.5)" />
              <Text style={styles.subCardBilling}>{billingLabel}</Text>
              <Text style={styles.subCardManage}>Manage Plan {'>'}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={styles.upgradeBanner}
            onPress={() => navigation.navigate('Subscription')}
          >
            <Feather name="shield" size={18} color={colors.brand.primary} />
            <View style={styles.upgradeBannerText}>
              <Text style={styles.upgradeBannerTitle}>No active plan</Text>
              <Text style={styles.upgradeBannerSub}>Tap to choose a protection plan</Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.brand.primary} />
          </Pressable>
        )}

        {/* ── Account settings section ── */}
        <Text style={styles.sectionLabel}>ACCOUNT SETTINGS</Text>
        <View style={styles.card}>
          <SettingsRow
            icon="user"
            iconBg="#E6F1FB"
            iconColor="#0C447C"
            label="Edit Profile"
            desc="Update your personal information"
          />
          <View style={styles.rowDivider} />
          <SettingsRow
            icon="bell"
            iconBg="#FFF3E0"
            iconColor="#E65100"
            label="Notification Settings"
            desc="Manage alert and security sounds"
          />
          <View style={styles.rowDivider} />
          <SettingsRow
            icon="shield"
            iconBg={colors.brand.light}
            iconColor={colors.brand.primary}
            label="Security & Privacy"
            desc="Password, 2FA, and app locking"
          />
        </View>

        {/* ── Log out button ── */}
        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]}
          onPress={() => setShowLogoutModal(true)}
        >
          <Feather name="log-out" size={16} color={colors.brand.sos} />
          <Text style={styles.logoutBtnText}>Log Out</Text>
        </Pressable>

        {/* ── Version ── */}
        <Text style={styles.version}>VERSION 1.0.0</Text>
      </ScrollView>

      {/* ── Bottom tab bar ── */}
      <View style={[styles.tabBar, { paddingBottom: insets.bottom || spacing.gap8 }]}>
        <TabItem icon="grid" label="Dashboard" onPress={() => navigation.navigate('Home')} />
        <TabItem icon="users" label="Circle" onPress={() => navigation.navigate('Circle')} />
        <TabItem icon="clock" label="History" onPress={() => navigation.navigate('Routes')} />
        <TabItem icon="user" label="Profile" active />
      </View>

      {/* ── Logout confirmation sheet ── */}
      <LogoutSheet
        visible={showLogoutModal}
        loggingOut={loggingOut}
        onStay={() => setShowLogoutModal(false)}
        onConfirm={handleLogout}
      />
    </View>
  );
};

// ── Settings row ──────────────────────────────────────────────────────────────

interface SettingsRowProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  iconBg: string;
  iconColor: string;
  label: string;
  desc: string;
  onPress?: () => void;
}

const SettingsRow = ({ icon, iconBg, iconColor, label, desc, onPress }: SettingsRowProps) => (
  <Pressable
    style={({ pressed }) => [styles.settingsRow, pressed && onPress && styles.rowPressed]}
    onPress={onPress}
    disabled={!onPress}
  >
    <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
      <Feather name={icon} size={16} color={iconColor} />
    </View>
    <View style={styles.rowBody}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowDesc}>{desc}</Text>
    </View>
    <Feather name="chevron-right" size={16} color={colors.brand.textSecondary} />
  </Pressable>
);

// ── Logout sheet ──────────────────────────────────────────────────────────────

interface LogoutSheetProps {
  visible: boolean;
  loggingOut: boolean;
  onStay: () => void;
  onConfirm: () => void;
}

const LogoutSheet = ({ visible, loggingOut, onStay, onConfirm }: LogoutSheetProps) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onStay}>
    <View style={sheet.overlay}>
      <View style={sheet.container}>
        <View style={sheet.handle} />
        <View style={sheet.iconWrap}>
          <Feather name="log-out" size={26} color="#C0392B" />
        </View>
        <Text style={sheet.title}>Log out of Hadin?</Text>
        <Text style={sheet.body}>
          You'll be signed out of this device. Any active trip will continue running until you end it.
        </Text>
        <View style={sheet.warningStrip}>
          <Feather name="alert-triangle" size={14} color="#B7880A" style={sheet.warningIcon} />
          <Text style={sheet.warningText}>
            If you have an active trip, your circle will no longer receive updates after logout.
          </Text>
        </View>
        <View style={sheet.btnRow}>
          <Pressable
            style={({ pressed }) => [sheet.stayBtn, pressed && { opacity: 0.8 }]}
            onPress={onStay}
            disabled={loggingOut}
          >
            <Text style={sheet.stayBtnText}>Stay logged in</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [sheet.logoutBtn, pressed && !loggingOut && { opacity: 0.85 }]}
            onPress={onConfirm}
            disabled={loggingOut}
          >
            {loggingOut ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={sheet.logoutBtnText}>Log out</Text>
            )}
          </Pressable>
        </View>
        {loggingOut ? (
          <Text style={sheet.signingOutText}>Signing you out…{'\n'}Clearing session securely</Text>
        ) : null}
      </View>
    </View>
  </Modal>
);

// ── Tab bar item ──────────────────────────────────────────────────────────────

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
      color={active ? colors.brand.primary : colors.brand.textSecondary}
    />
    {active && <View style={styles.tabActiveLine} />}
    <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
  </Pressable>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand.bgSurface },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.screenPadding,
  },

  pageHeader: {
    paddingBottom: spacing.gap16,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.brand.textPrimary,
    letterSpacing: -0.3,
  },

  // Subscription card (active/trial)
  subCard: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: spacing.cardPadding,
    marginBottom: spacing.gap16,
  },
  subCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  planBadge: {
    backgroundColor: '#1E293B',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  planBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.8,
  },
  subCardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 3,
  },
  subCardPrice: {
    fontSize: fontSizes.caption,
    color: 'rgba(255,255,255,0.45)',
  },
  subCardShield: { opacity: 0.4 },
  subCardDivider: { height: 0.5, backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: 12 },
  subCardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subCardBilling: {
    flex: 1,
    fontSize: fontSizes.small,
    color: 'rgba(255,255,255,0.5)',
  },
  subCardManage: {
    fontSize: fontSizes.small,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
  },

  // No subscription banner
  upgradeBanner: {
    backgroundColor: colors.brand.light,
    borderRadius: 14,
    padding: spacing.cardPadding,
    borderWidth: 0.5,
    borderColor: colors.brand.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gap12,
    marginBottom: spacing.gap16,
  },
  upgradeBannerText: { flex: 1 },
  upgradeBannerTitle: { fontSize: fontSizes.caption, fontWeight: '700', color: colors.brand.primary },
  upgradeBannerSub: { fontSize: fontSizes.small, color: colors.brand.textSecondary, marginTop: 2 },

  // Section label
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.brand.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.gap8,
  },

  // Account card
  card: {
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: '#EEECe6',
    overflow: 'hidden',
    marginBottom: spacing.gap16,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gap12,
    padding: spacing.cardPadding,
  },
  rowPressed: { backgroundColor: colors.brand.bgSurface },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  rowBody: { flex: 1 },
  rowLabel: { fontSize: fontSizes.caption, fontWeight: '600', color: colors.brand.textPrimary },
  rowDesc: { fontSize: 11, color: colors.brand.textSecondary, marginTop: 2 },
  rowDivider: { height: 0.5, backgroundColor: '#F4F3EF', marginLeft: 58 },

  // Log out button
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: colors.white,
    marginBottom: spacing.gap16,
  },
  logoutBtnText: {
    fontSize: fontSizes.body,
    fontWeight: '600',
    color: colors.brand.sos,
  },

  version: {
    fontSize: 10,
    color: colors.brand.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.gap8,
  },

  pressed: { opacity: 0.8 },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.brand.border,
    paddingTop: spacing.gap8,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 3 },
  tabActiveLine: {
    width: 20,
    height: 2,
    backgroundColor: colors.brand.primary,
    borderRadius: 2,
    marginTop: -2,
  },
  tabLabel: { fontSize: fontSizes.small, color: colors.brand.textSecondary },
  tabLabelActive: { color: colors.brand.primary, fontWeight: '600' },
});

const sheet = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  container: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: 36,
  },
  handle: {
    width: 32,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#FDEDEC',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.brand.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 12,
    color: colors.brand.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  warningStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF9EC',
    borderWidth: 1,
    borderColor: '#F5E4A0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  warningIcon: { flexShrink: 0, marginTop: 1 },
  warningText: { flex: 1, fontSize: fontSizes.small, color: '#856800', lineHeight: 17 },
  btnRow: { flexDirection: 'row', gap: spacing.gap12 },
  stayBtn: {
    flex: 1,
    backgroundColor: '#F4F3EF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  stayBtnText: { fontSize: fontSizes.body, fontWeight: '600', color: colors.brand.textPrimary },
  logoutBtn: {
    flex: 1,
    backgroundColor: '#C0392B',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutBtnText: { fontSize: fontSizes.body, fontWeight: '700', color: colors.white },
  signingOutText: {
    textAlign: 'center',
    fontSize: 11,
    color: colors.brand.textSecondary,
    marginTop: 12,
    lineHeight: 17,
  },
});

export default SettingsScreen;

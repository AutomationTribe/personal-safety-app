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
  trialEnd: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function trialDaysRemaining(trialEnd: string | null): number {
  if (!trialEnd) return 0;
  const ms = new Date(trialEnd).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function badgeLabel(status: string, trialEnd: string | null): string | null {
  if (status === 'active') return 'Hadin Pro · Active';
  if (status === 'trial') {
    const days = trialDaysRemaining(trialEnd);
    return `Free trial · ${days} day${days !== 1 ? 's' : ''} remaining`;
  }
  return null;
}

// ── SettingsScreen ────────────────────────────────────────────────────────────

const SettingsScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [profile, setProfile] = useState<ProfileData>({
    name: '',
    email: '',
    subscriptionStatus: 'free',
    trialEnd: null,
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
        .select('subscription_status, trial_end')
        .eq('id', user.id)
        .single();

      setProfile({
        name,
        email,
        subscriptionStatus: (data as { subscription_status: string; trial_end: string | null } | null)?.subscription_status ?? 'free',
        trialEnd: (data as { subscription_status: string; trial_end: string | null } | null)?.trial_end ?? null,
      });
    } catch {
      // Non-fatal — show empty state
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // ── Logout ────────────────────────────────────────────────────────────────

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      // Stop any active trip tracking and flush the location queue
      await stopTracking().catch((e) => console.warn('[Settings] stopTracking error:', e));
      await flushQueue().catch((e) => console.warn('[Settings] flushQueue error:', e));

      // Revoke refresh token server-side — critical at scale
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[Settings] signOut error:', e);
    } finally {
      // Always clear local storage even if signOut had an error
      await AsyncStorage.clear().catch((e) => console.warn('[Settings] AsyncStorage.clear error:', e));
      setLoggingOut(false);
      // AppNavigator's onAuthStateChange detects the cleared session
      // and switches the root to AuthStack (Login). No explicit navigate needed.
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const badge = badgeLabel(profile.subscriptionStatus, profile.trialEnd);
  const displayName = profile.name || 'Traveller';

  return (
    <View style={styles.root}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.headerTitle}>Settings</Text>
        <Text style={styles.headerSub}>Account and preferences</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile card ── */}
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(displayName) || '?'}</Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{displayName}</Text>
              {profile.email ? (
                <Text style={styles.profileEmail}>{profile.email}</Text>
              ) : null}
              {badge ? (
                <View style={styles.subBadge}>
                  <View style={styles.subBadgeDot} />
                  <Text style={styles.subBadgeText}>{badge}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* ── Account section ── */}
        <View style={styles.sectionLabel}>
          <Text style={styles.sectionLabelText}>ACCOUNT</Text>
        </View>
        <View style={styles.card}>
          <SettingsRow
            iconBg="#E6F1FB"
            iconColor="#0C447C"
            icon="user"
            label="Edit profile"
            desc="Update your name and photo"
          />
          <View style={styles.rowDivider} />
          <SettingsRow
            iconBg="#FFF3E0"
            iconColor="#E65100"
            icon="bell"
            label="Notifications"
            desc="Alerts, trip updates, and reminders"
          />
          <View style={styles.rowDivider} />
          <SettingsRow
            iconBg={colors.brand.light}
            iconColor={colors.brand.primary}
            icon="shield"
            label="Subscription"
            desc={badge ?? 'Free plan'}
            onPress={() => navigation.navigate('Subscription')}
          />
        </View>

        {/* ── Support section ── */}
        <View style={styles.sectionLabel}>
          <Text style={styles.sectionLabelText}>SUPPORT</Text>
        </View>
        <View style={styles.card}>
          <SettingsRow
            iconBg="#E0F7FA"
            iconColor="#006064"
            icon="help-circle"
            label="Help & FAQ"
            desc="Guides, tips, and answers"
          />
          <View style={styles.rowDivider} />
          <SettingsRow
            iconBg="#EDE7F6"
            iconColor="#4527A0"
            icon="file-text"
            label="Privacy Policy"
            desc="How we handle your data"
          />
        </View>

        {/* ── Danger section ── */}
        <View style={styles.card}>
          <SettingsRow
            iconBg="#FDEDEC"
            iconColor="#C0392B"
            icon="log-out"
            label="Log out"
            desc="Sign out of this device"
            labelStyle={styles.logoutLabel}
            onPress={() => setShowLogoutModal(true)}
          />
        </View>
      </ScrollView>

      {/* ── Bottom tab bar ── */}
      <View style={[styles.tabBar, { paddingBottom: insets.bottom || spacing.gap8 }]}>
        <TabItem icon="home" label="Home" onPress={() => navigation.navigate('Home')} />
        <TabItem icon="map" label="Routes" onPress={() => navigation.navigate('Routes')} />
        <TabItem icon="users" label="Circle" onPress={() => navigation.navigate('Circle')} />
        <TabItem icon="settings" label="Settings" active />
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
  iconBg: string;
  iconColor: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  desc: string;
  labelStyle?: object;
  onPress?: () => void;
}

const SettingsRow = ({ iconBg, iconColor, icon, label, desc, labelStyle, onPress }: SettingsRowProps) => (
  <Pressable
    style={({ pressed }) => [styles.settingsRow, pressed && onPress && styles.rowPressed]}
    onPress={onPress}
    disabled={!onPress}
  >
    <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
      <Feather name={icon} size={16} color={iconColor} />
    </View>
    <View style={styles.rowBody}>
      <Text style={[styles.rowLabel, labelStyle]}>{label}</Text>
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
  <Modal
    visible={visible}
    transparent
    animationType="slide"
    onRequestClose={onStay}
  >
    <View style={sheet.overlay}>
      <View style={sheet.container}>
        {/* Handle bar */}
        <View style={sheet.handle} />

        {/* Icon */}
        <View style={sheet.iconWrap}>
          <Feather name="log-out" size={26} color="#C0392B" />
        </View>

        {/* Title */}
        <Text style={sheet.title}>Log out of Hadin?</Text>

        {/* Body */}
        <Text style={sheet.body}>
          You'll be signed out of this device. Any active trip will continue running until you end it.
        </Text>

        {/* Warning strip */}
        <View style={sheet.warningStrip}>
          <Feather name="alert-triangle" size={14} color="#B7880A" style={sheet.warningIcon} />
          <Text style={sheet.warningText}>
            If you have an active trip, your circle will no longer receive updates after logout.
          </Text>
        </View>

        {/* Buttons */}
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

  header: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.gap12,
    borderBottomWidth: 1,
    borderBottomColor: colors.brand.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.brand.textPrimary,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: fontSizes.small,
    color: colors.brand.textSecondary,
    marginTop: 2,
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.gap16,
  },

  // Profile card
  card: {
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: '#EEECe6',
    overflow: 'hidden',
    marginBottom: 4,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gap12,
    padding: spacing.cardPadding,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.brand.primary,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  avatarText: { color: colors.white, fontSize: fontSizes.body, fontWeight: '700' },
  profileInfo: { flex: 1, gap: 3 },
  profileName: { fontSize: 14, fontWeight: '700', color: colors.brand.textPrimary },
  profileEmail: { fontSize: fontSizes.small, color: colors.brand.textSecondary },
  subBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  subBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ADE80' },
  subBadgeText: { fontSize: 10, color: colors.brand.primary, fontWeight: '600' },

  // Section label
  sectionLabel: { paddingTop: spacing.gap12, paddingBottom: 6, paddingHorizontal: 4 },
  sectionLabelText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.brand.textSecondary,
    letterSpacing: 0.8,
  },

  // Settings rows
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
  logoutLabel: { color: '#C0392B' },
  rowDivider: { height: 0.5, backgroundColor: '#F4F3EF', marginLeft: 58 },

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
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
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
  warningText: {
    flex: 1,
    fontSize: fontSizes.small,
    color: '#856800',
    lineHeight: 17,
  },
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

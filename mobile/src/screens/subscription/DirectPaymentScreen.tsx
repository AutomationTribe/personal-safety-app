import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CommonActions, RouteProp } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AppStackParamList } from '../../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<AppStackParamList, 'DirectPayment'>;
  route: RouteProp<AppStackParamList, 'DirectPayment'>;
};

const PLAN_CONFIG = {
  basic: { label: 'Essential Safety', planName: 'Essential Safety Plan', price: '₦20,000' },
  elite: { label: 'Complete Peace of Mind', planName: 'Elite Plan', price: '₦35,000' },
} as const;

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
console.log('[DirectPayment] BACKEND_URL:', BACKEND_URL);

const PAYSTACK_CALLBACK_HOST = 'hadin.app';

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

const DirectPaymentScreen = ({ navigation, route }: Props) => {
  const insets = useSafeAreaInsets();
  const { plan } = route.params;
  const planConfig = PLAN_CONFIG[plan];

  const [initializing, setInitializing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [pendingReference, setPendingReference] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // ── Step 1: Initialize Paystack transaction ───────────────────────────────

  const handleConfirm = async () => {
    setInitializing(true);
    setError('');

    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${BACKEND_URL}/api/v1/payments/init`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plan }),
      });

      const data = await res.json() as {
        authorization_url?: string;
        reference?: string;
        error?: string;
      };

      if (!res.ok || !data.authorization_url) {
        throw new Error(data.error ?? 'Could not start payment');
      }

      setPendingReference(data.reference ?? null);
      setAuthorizationUrl(data.authorization_url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment could not be started';
      setError(msg);
    } finally {
      setInitializing(false);
    }
  };

  // ── Step 2: Detect Paystack callback URL in WebView ───────────────────────

  const handleWebViewNavigation = (state: WebViewNavigation) => {
    if (state.url.includes(PAYSTACK_CALLBACK_HOST)) {
      const url = new URL(state.url);
      const reference =
        url.searchParams.get('reference') ??
        url.searchParams.get('trxref') ??
        pendingReference;

      setAuthorizationUrl(null);
      if (reference) {
        void handleVerify(reference);
      } else {
        setError('Payment reference missing. Contact support if charged.');
      }
    }
  };

  // ── Step 3: Verify payment on backend ────────────────────────────────────

  const handleVerify = async (reference: string) => {
    setVerifying(true);
    setError('');

    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${BACKEND_URL}/api/v1/payments/verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reference }),
      });

      const data = await res.json() as { success?: boolean; error?: string };

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? 'Payment could not be confirmed');
      }

      setShowSuccessModal(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not confirm payment';
      setError(msg);
    } finally {
      setVerifying(false);
    }
  };

  const busy = initializing || verifying;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* ── Nav bar ── */}
      <View style={[styles.navBar, { paddingTop: insets.top + 4 }]}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          onPress={() => navigation.goBack()}
          hitSlop={12}
        >
          <Feather name="chevron-left" size={18} color="#111827" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>

      {/* ── Title section ── */}
      <View style={styles.titleSection}>
        <Text style={styles.headline}>{planConfig.label}</Text>
        <Text style={styles.headlineSub}>{planConfig.price}/year · Cancel anytime</Text>
      </View>

      {/* ── Body ── */}
      <View style={styles.body}>
        {/* Summary card */}
        <View style={styles.card}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryKey}>Plan</Text>
            <Text style={styles.summaryVal}>{planConfig.label}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryKey}>Billing</Text>
            <Text style={styles.summaryVal}>Yearly</Text>
          </View>
          <View style={[styles.summaryRow, styles.summaryTotalRow]}>
            <Text style={styles.summaryKey}>Charged today</Text>
            <Text style={styles.summaryTotal}>{planConfig.price}</Text>
          </View>
        </View>

        {/* Paystack trust badge */}
        <View style={styles.secureRow}>
          <Feather name="lock" size={13} color="#6B7280" />
          <Text style={styles.secureText}>Secured by Paystack · PCI-DSS compliant</Text>
        </View>

        {/* Error */}
        {error ? (
          <View style={styles.errorBox}>
            <Feather name="alert-circle" size={14} color={colors.brand.sos} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.legal}>
          You'll be charged {planConfig.price}/year until cancelled.
          Cancel anytime from Settings.
        </Text>

        {/* Confirm button */}
        <Pressable
          style={({ pressed }) => [
            styles.confirmBtn,
            busy && styles.confirmBtnDisabled,
            pressed && !busy && styles.pressed,
          ]}
          onPress={handleConfirm}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.confirmBtnText}>
              {verifying ? 'Confirming…' : 'Confirm Subscription'}
            </Text>
          )}
        </Pressable>
      </View>

      {/* ── Subscription Activated modal ── */}
      <Modal
        visible={showSuccessModal}
        transparent
        animationType="fade"
        statusBarTranslucent
      >
        <View style={styles.successOverlay}>
          <View style={styles.successCard}>
            <View style={styles.successIconCircle}>
              <Feather name="check" size={32} color={colors.white} />
            </View>
            <Text style={styles.successTitle}>Subscription Activated</Text>
            <Text style={styles.successBody}>
              Your account has been upgraded to the {planConfig.planName}. You now have full
              access to all premium safety features.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.successBtn, pressed && styles.pressed]}
              onPress={() => {
                setShowSuccessModal(false);
                navigation.dispatch(
                  CommonActions.reset({ index: 0, routes: [{ name: 'Home' }] }),
                );
              }}
            >
              <Text style={styles.successBtnText}>Go to Dashboard</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Paystack WebView modal ── */}
      <Modal
        visible={!!authorizationUrl}
        animationType="slide"
        onRequestClose={() => setAuthorizationUrl(null)}
      >
        <View style={[styles.webViewRoot, { paddingTop: insets.top }]}>
          <View style={styles.webViewHeader}>
            <Pressable
              style={styles.webViewClose}
              onPress={() => setAuthorizationUrl(null)}
              hitSlop={12}
            >
              <Feather name="x" size={20} color={colors.brand.textPrimary} />
            </Pressable>
            <Text style={styles.webViewTitle}>Paystack Checkout</Text>
            <View style={styles.webViewLock}>
              <Feather name="lock" size={13} color={colors.brand.primary} />
            </View>
          </View>

          {authorizationUrl ? (
            <WebView
              source={{ uri: authorizationUrl }}
              onNavigationStateChange={handleWebViewNavigation}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.webViewLoading}>
                  <ActivityIndicator size="large" color="#4B0082" />
                  <Text style={styles.webViewLoadingText}>Loading Paystack…</Text>
                </View>
              )}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FB' },

  navBar: {
    paddingHorizontal: 22,
    paddingBottom: 14,
    backgroundColor: '#F8F9FB',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  backText: { fontSize: 16, color: '#111827', fontWeight: '500' },

  titleSection: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 24,
  },
  headline: {
    fontSize: 23,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  headlineSub: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },

  body: { paddingHorizontal: 18, gap: 16 },

  card: {
    backgroundColor: colors.white,
    borderRadius: 7,
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: '#EDF0F4',
    shadowColor: '#111827',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F5F8',
  },
  summaryTotalRow: { borderBottomWidth: 0, paddingTop: 18, paddingBottom: 6 },
  summaryKey: { fontSize: 14, color: '#546780', fontWeight: '500' },
  summaryVal: { fontSize: 15, fontWeight: '800', color: '#111827' },
  summaryTotal: { fontSize: 21, fontWeight: '800', color: '#1F6B45' },

  secureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 6,
    marginTop: 2,
  },
  secureText: { fontSize: 12, color: '#6B7280', fontWeight: '600' },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 12,
  },
  errorText: { flex: 1, color: colors.brand.sos, fontSize: fontSizes.caption, lineHeight: 18 },

  legal: {
    fontSize: 12,
    color: '#7D8AA0',
    lineHeight: 18,
    paddingHorizontal: 6,
    marginTop: -2,
  },

  confirmBtn: {
    backgroundColor: '#5317CF',
    borderRadius: 7,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 2,
    shadowColor: '#5317CF',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  confirmBtnDisabled: { opacity: 0.7 },
  confirmBtnText: { fontSize: 16, fontWeight: '800', color: colors.white },

  pressed: { opacity: 0.8 },

  // Success modal
  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  successCard: {
    backgroundColor: colors.white,
    borderRadius: 20,
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 28,
    alignItems: 'center',
    width: '100%',
  },
  successIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.brand.textPrimary,
    marginBottom: 10,
    textAlign: 'center',
  },
  successBody: {
    fontSize: fontSizes.caption,
    color: colors.brand.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },
  successBtn: {
    width: '100%',
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  successBtnText: {
    fontSize: fontSizes.body,
    fontWeight: '700',
    color: colors.white,
  },

  // WebView modal
  webViewRoot: { flex: 1, backgroundColor: colors.white },
  webViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screenPadding,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEECe6',
  },
  webViewClose: { padding: 4 },
  webViewTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSizes.body,
    fontWeight: '600',
    color: colors.brand.textPrimary,
  },
  webViewLock: { padding: 4 },
  webViewLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  webViewLoadingText: {
    marginTop: 12,
    fontSize: fontSizes.caption,
    color: colors.brand.textSecondary,
  },
});

export default DirectPaymentScreen;

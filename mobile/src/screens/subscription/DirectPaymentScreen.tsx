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
import { supabase } from '../../lib/supabase';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AppStackParamList } from '../../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<AppStackParamList, 'DirectPayment'>;
};

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
console.log('[DirectPayment] BACKEND_URL:', BACKEND_URL);

// This matches the callback_url sent to Paystack in /init.
// The WebView intercepts navigation to this URL to detect payment completion.
const PAYSTACK_CALLBACK_HOST = 'hadin.app';

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

const DirectPaymentScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();

  const [initializing, setInitializing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [pendingReference, setPendingReference] = useState<string | null>(null);
  const [error, setError] = useState('');

  // ── Step 1: Initialize Paystack transaction ───────────────────────────────

  const handlePay = async () => {
    setInitializing(true);
    setError('');

    try {
      const token = await getAuthToken();
      console.log('[Pay] token present:', !!token);

      if (!token) throw new Error('Not authenticated');

      const url = `${BACKEND_URL}/api/v1/payments/init`;
      console.log('[Pay] calling:', url);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('[Pay] response status:', res.status);

      const data = await res.json() as {
        authorization_url?: string;
        reference?: string;
        error?: string;
      };

      console.log('[Pay] response body:', JSON.stringify(data));

      if (!res.ok || !data.authorization_url) {
        throw new Error(data.error ?? 'Could not start payment');
      }

      setPendingReference(data.reference ?? null);
      setAuthorizationUrl(data.authorization_url);
    } catch (err) {
      console.error('[Pay] error:', err);
      const msg = err instanceof Error ? err.message : 'Payment could not be started';
      setError(msg);
    } finally {
      setInitializing(false);
    }
  };

  // ── Step 2: Detect Paystack callback URL in WebView ───────────────────────

  const handleWebViewNavigation = (state: WebViewNavigation) => {
    if (state.url.includes(PAYSTACK_CALLBACK_HOST)) {
      // Paystack is redirecting to our callback — extract the reference
      const url = new URL(state.url);
      const reference =
        url.searchParams.get('reference') ??
        url.searchParams.get('trxref') ??
        pendingReference;

      setAuthorizationUrl(null); // close WebView
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
      console.log('[Verify] reference:', reference);

      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${BACKEND_URL}/api/v1/payments/verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reference }),
      });

      console.log('[Verify] status:', res.status);
      const data = await res.json() as { success?: boolean; error?: string };
      console.log('[Verify] body:', JSON.stringify(data));

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? 'Payment could not be confirmed');
      }

      navigation.navigate('Success', { type: 'subscriber' });
    } catch (err) {
      console.error('[Verify] error:', err);
      const msg = err instanceof Error ? err.message : 'Could not confirm payment';
      setError(msg);
    } finally {
      setVerifying(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* ── Green header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={12}>
          <Feather name="arrow-left" size={18} color="rgba(255,255,255,0.6)" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.headline}>Subscribe to Hadin Pro</Text>
        <Text style={styles.headerSub}>₦25,000/year · Cancel anytime</Text>
      </View>

      {/* ── Body ── */}
      <View style={styles.body}>
        {/* Summary card */}
        <View style={styles.card}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryKey}>Plan</Text>
            <Text style={styles.summaryVal}>Hadin Pro</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryKey}>Billing</Text>
            <Text style={styles.summaryVal}>Yearly</Text>
          </View>
          <View style={[styles.summaryRow, styles.summaryTotalRow]}>
            <Text style={styles.summaryKey}>Charged today</Text>
            <Text style={styles.summaryTotal}>₦25,000</Text>
          </View>
        </View>

        {/* Paystack trust badge */}
        <View style={styles.secureRow}>
          <Feather name="lock" size={13} color={colors.brand.textSecondary} />
          <Text style={styles.secureText}>Secured by Paystack · PCI-DSS compliant</Text>
        </View>

        {/* What happens */}
        <View style={styles.infoCard}>
          <Feather name="info" size={14} color={colors.brand.primary} style={styles.infoIcon} />
          <Text style={styles.infoText}>
            Tapping "Pay" opens Paystack's secure checkout. Enter your card details there —
            your card number never touches our servers.
          </Text>
        </View>

        {/* Error */}
        {error ? (
          <View style={styles.errorBox}>
            <Feather name="alert-circle" size={14} color={colors.brand.sos} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Pay button */}
        <Pressable
          style={({ pressed }) => [
            styles.payBtn,
            (initializing || verifying) && styles.payBtnDisabled,
            pressed && !initializing && !verifying && styles.pressed,
          ]}
          onPress={handlePay}
          disabled={initializing || verifying}
        >
          {initializing || verifying ? (
            <View style={styles.payBtnInner}>
              <ActivityIndicator color={colors.white} size="small" />
              <Text style={styles.payBtnText}>
                {verifying ? 'Confirming payment…' : 'Opening checkout…'}
              </Text>
            </View>
          ) : (
            <Text style={styles.payBtnText}>Pay ₦25,000 →</Text>
          )}
        </Pressable>

        <Text style={styles.legal}>
          You'll be charged ₦25,000/year until cancelled.
          Cancel anytime from Settings.
        </Text>
      </View>

      {/* ── Paystack WebView modal ── */}
      <Modal
        visible={!!authorizationUrl}
        animationType="slide"
        onRequestClose={() => setAuthorizationUrl(null)}
      >
        <View style={[styles.webViewRoot, { paddingTop: insets.top }]}>
          {/* Close bar */}
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
                  <ActivityIndicator size="large" color={colors.brand.primary} />
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
  root: { flex: 1, backgroundColor: colors.brand.bgSurface },

  header: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.gap20,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 12 },
  backText: { fontSize: fontSizes.caption, color: 'rgba(255,255,255,0.6)' },
  headline: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  headerSub: { fontSize: fontSizes.caption, color: 'rgba(255,255,255,0.6)' },

  body: { padding: spacing.screenPadding, gap: spacing.gap12 },

  card: {
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: spacing.cardPadding,
    borderWidth: 0.5,
    borderColor: '#EEECe6',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F4F3EF',
  },
  summaryTotalRow: { borderBottomWidth: 0, paddingTop: 9, marginTop: 3 },
  summaryKey: { fontSize: fontSizes.caption, color: colors.brand.textSecondary },
  summaryVal: { fontSize: fontSizes.caption, fontWeight: '600', color: colors.brand.textPrimary },
  summaryTotal: { fontSize: 15, fontWeight: '800', color: colors.brand.primary },

  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  secureText: { fontSize: 10, color: colors.brand.textSecondary },

  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.brand.light,
    borderRadius: 10,
    padding: 12,
    borderWidth: 0.5,
    borderColor: colors.brand.border,
  },
  infoIcon: { flexShrink: 0, marginTop: 1 },
  infoText: {
    flex: 1,
    fontSize: fontSizes.small,
    color: colors.brand.primary,
    lineHeight: 17,
  },

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

  payBtn: {
    backgroundColor: colors.brand.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  payBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  payBtnDisabled: { opacity: 0.7 },
  payBtnText: { fontSize: fontSizes.body, fontWeight: '700', color: colors.white },
  pressed: { opacity: 0.8 },

  legal: { fontSize: 10, color: '#B4B2A9', textAlign: 'center', lineHeight: 16 },

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

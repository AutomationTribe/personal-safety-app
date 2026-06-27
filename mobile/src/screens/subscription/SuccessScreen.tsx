import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CommonActions, RouteProp } from '@react-navigation/native';
import { colors, fontSizes, spacing } from '../../styles/tokens';
import { AppStackParamList } from '../../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<AppStackParamList, 'Success'>;
  route: RouteProp<AppStackParamList, 'Success'>;
};

const SuccessScreen = ({ navigation, route }: Props) => {
  const insets = useSafeAreaInsets();
  const { type } = route.params;
  const isTrial = type === 'trial';

  const handleGoToHadin = () => {
    navigation.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: 'Home' }] }),
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Feather name="shield" size={30} color={colors.white} />
        </View>

        <Text style={styles.title}>You're protected.</Text>
        <Text style={styles.subtitle}>
          Your circle is set up and ready. They'll be there when you need them most.
        </Text>

        <View style={styles.badge}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>
            {isTrial ? 'Free trial · 3 days remaining' : 'Hadin Pro · Active'}
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          onPress={handleGoToHadin}
        >
          <Text style={styles.ctaText}>Go to Hadin →</Text>
        </Pressable>

        <Text style={styles.note}>
          {isTrial
            ? 'Card charged $25 on day 4 unless cancelled'
            : 'Billed $25/year · Cancel anytime from settings'}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.brand.primary,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.screenPadding,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.gap20,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -0.4,
    marginBottom: spacing.gap8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: fontSizes.body,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: spacing.gap24,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginBottom: spacing.gap24,
  },
  badgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ADE80' },
  badgeText: { fontSize: fontSizes.body, color: colors.white, fontWeight: '600' },
  cta: {
    width: '100%',
    backgroundColor: colors.white,
    borderRadius: 13,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: spacing.gap16,
  },
  ctaText: { fontSize: fontSizes.button, fontWeight: '700', color: colors.brand.primary },
  pressed: { opacity: 0.85 },
  note: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
  },
});

export default SuccessScreen;

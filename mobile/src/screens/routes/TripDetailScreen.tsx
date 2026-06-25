import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, fontSizes, spacing } from '../../styles/tokens';

const TripDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Pressable style={styles.back} onPress={() => navigation.goBack()}>
        <Feather name="arrow-left" size={20} color={colors.brand.primary} />
        <Text style={styles.backText}>Back to routes</Text>
      </Pressable>
      <View style={styles.centerWrap}>
        <View style={styles.iconWrap}>
          <Feather name="map" size={28} color={colors.brand.primary} />
        </View>
        <Text style={styles.title}>Trip detail</Text>
        <Text style={styles.sub}>Coming soon</Text>
      </View>
    </View>
  );
};

export default TripDetailScreen;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.brand.bgSurface,
    paddingHorizontal: spacing.screenPadding,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  backText: {
    fontSize: fontSizes.body,
    fontWeight: '600',
    color: colors.brand.primary,
  },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.brand.light,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.brand.textPrimary,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  sub: {
    fontSize: 14,
    color: colors.brand.textSecondary,
  },
});

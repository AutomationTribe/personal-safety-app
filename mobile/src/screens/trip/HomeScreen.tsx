import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fontSizes, spacing } from '../../styles/tokens';

const HomeScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Home</Text>
      <Text style={styles.subtitle}>This is the placeholder home screen.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.screenPadding,
    backgroundColor: colors.background,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.heading,
    fontWeight: '700',
    marginBottom: spacing.base,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    textAlign: 'center',
  },
});

export default HomeScreen;

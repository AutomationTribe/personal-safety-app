import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import HadinLogo from './HadinLogo';

const AppSplashScreen = () => (
  <LinearGradient
    colors={['#7C3AED', '#4B0082', '#2E0854']}
    start={{ x: 0.15, y: 0 }}
    end={{ x: 0.85, y: 1 }}
    style={styles.root}
  >
    <View style={styles.center}>
      <View style={styles.logoCard}>
        <HadinLogo size={64} />
      </View>
      <Text style={styles.title}>HADIN</Text>
      <Text style={styles.tagline}>Safe together.</Text>
      <View style={styles.divider} />
    </View>

    <View style={styles.footer}>
      <View style={styles.footerRow}>
        <Feather name="shield" size={14} color="rgba(255,255,255,0.65)" />
        <Text style={styles.footerLabel}>SECURED INFRASTRUCTURE</Text>
      </View>
      <Text style={styles.footerCopyright}>Hadin Security Systems © 2024</Text>
    </View>
  </LinearGradient>
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoCard: {
    width: 100,
    height: 100,
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1.5,
  },
  tagline: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 8,
  },
  divider: {
    width: 130,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: 36,
  },
  footer: {
    alignItems: 'center',
    paddingBottom: 48,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.65)',
  },
  footerCopyright: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 6,
  },
});

export default AppSplashScreen;

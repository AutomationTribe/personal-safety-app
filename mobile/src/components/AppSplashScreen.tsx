import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import HadinLogo from './HadinLogo';

const DOT_COUNT = 3;
const PULSE_DURATION_MS = 500;
const DOT_STAGGER_MS = 160;

const LoadingDots = () => {
  const pulses = useRef(
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(0.3))
  ).current;

  useEffect(() => {
    const animations = pulses.map((pulse, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * DOT_STAGGER_MS),
          Animated.timing(pulse, {
            toValue: 1,
            duration: PULSE_DURATION_MS,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0.3,
            duration: PULSE_DURATION_MS,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.delay((DOT_COUNT - 1 - index) * DOT_STAGGER_MS),
        ])
      )
    );
    Animated.parallel(animations).start();
    return () => animations.forEach((anim) => anim.stop());
  }, [pulses]);

  return (
    <View style={styles.dotsRow}>
      {pulses.map((pulse, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            { opacity: pulse, transform: [{ scale: pulse }] },
          ]}
        />
      ))}
    </View>
  );
};

const AppSplashScreen = () => (
  <LinearGradient
    colors={['#7C3AED', '#4B0082', '#2E0854']}
    start={{ x: 0.15, y: 0 }}
    end={{ x: 0.85, y: 1 }}
    style={styles.root}
  >
    <View style={styles.center}>
      <View style={styles.logoCard}>
        <HadinLogo size={76} />
      </View>
      <Text style={styles.title}>HADIN</Text>
      <Text style={styles.tagline}>Safe together.</Text>
      <View style={styles.divider} />
      <LoadingDots />
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
    width: 112,
    height: 112,
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
  dotsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 28,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#FFFFFF',
  },
});

export default AppSplashScreen;

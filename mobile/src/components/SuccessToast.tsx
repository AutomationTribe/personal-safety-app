import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  onHide?: () => void;
  duration?: number;
}

const SuccessToast = ({ visible, title, subtitle, onHide, duration = 3000 }: Props) => {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isVisible = useRef(false);

  const exit = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -80,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        isVisible.current = false;
        onHide?.();
      }
    });
  }, [translateY, opacity, onHide]);

  useEffect(() => {
    if (visible && !isVisible.current) {
      isVisible.current = true;
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      dismissTimer.current = setTimeout(exit, duration);
    } else if (!visible && isVisible.current) {
      exit();
    }

    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [visible, duration, exit, translateY, opacity]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.container,
        { paddingTop: insets.top + 13, transform: [{ translateY }], opacity },
      ]}
    >
      <Feather name="check-circle" size={19} color="#FFFFFF" />
      <View style={styles.textBlock}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
        ) : null}
      </View>
      <Pressable style={styles.closeBtn} onPress={exit} hitSlop={10}>
        <Feather name="x" size={19} color="#FFFFFF" />
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16A34A',
    paddingBottom: 16,
    paddingHorizontal: 28,
    gap: 13,
    zIndex: 9999,
    elevation: 10,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 2,
    lineHeight: 15,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SuccessToast;

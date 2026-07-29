import React, { useEffect, useRef } from 'react';
import { Animated, BackHandler, ImageBackground, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Audio } from 'expo-av';
import { AppStackParamList } from '../../navigation/AppNavigator';
import { answerFakeCall, rejectFakeCall } from '../../services/FakeCallKeepService';
import { colors } from '../../styles/tokens';

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

const IncomingCallScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const route = useRoute<RouteProp<AppStackParamList, 'IncomingCall'>>();
  const { callerName, callUUID } = route.params;

  const soundRef = useRef<Audio.Sound | null>(null);
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Self-managed telecom connections (which is what real CallKeep calls
      // are here) don't get an automatic system ringtone — Android's docs
      // are explicit that self-managed apps are responsible for playing
      // their own. Prefer the device's actual default ringtone (so it
      // sounds like a real call) and only fall back to the bundled tone if
      // that content URI can't be resolved.
      if (Platform.OS === 'android') {
        try {
          const { sound } = await Audio.Sound.createAsync(
            { uri: 'content://settings/system/ringtone' },
            { isLooping: true, volume: 1 },
          );
          if (cancelled) {
            await sound.unloadAsync();
            return;
          }
          soundRef.current = sound;
          await sound.playAsync();
          return;
        } catch {
          // Fall through to the bundled tone below.
        }
      }

      try {
        const { sound } = await Audio.Sound.createAsync(
          require('../../../assets/audio/ringtone.wav'),
          { isLooping: true, volume: 1 },
        );
        if (cancelled) {
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
        await sound.playAsync();
      } catch {
        // Ringtone asset missing/failed to load — call still proceeds silently.
      }
    })();

    return () => {
      cancelled = true;
      soundRef.current?.stopAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, []);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  const stopRingtone = async () => {
    try {
      await soundRef.current?.stopAsync();
      await soundRef.current?.unloadAsync();
    } catch {
      // Already stopped/unloaded
    }
    soundRef.current = null;
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const handleDecline = async () => {
    await stopRingtone();
    if (callUUID) rejectFakeCall(callUUID);
    navigation.navigate('Home');
  };

  const handleAccept = async () => {
    await stopRingtone();
    if (callUUID) answerFakeCall(callUUID);
    navigation.replace('ActiveCall', { callerName, callUUID });
  };

  return (
    <ImageBackground
      source={require('../../../assets/call-screen-bg.png')}
      style={ic.root}
      resizeMode="cover"
    >
      <View style={[ic.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 }]}>
        <View style={ic.avatar}>
          <Text style={ic.avatarText}>{initials(callerName)}</Text>
        </View>
        <Text style={ic.name} numberOfLines={1}>{callerName}</Text>
        <Animated.Text style={[ic.subtitle, { opacity: pulse }]}>Incoming Call</Animated.Text>

        <View style={ic.controls}>
          <View style={ic.controlCol}>
            <Pressable style={({ pressed }) => [ic.declineBtn, pressed && ic.pressed]} onPress={handleDecline}>
              <Feather name="phone-off" size={28} color={colors.white} />
            </Pressable>
            <Text style={ic.controlLabel}>Decline</Text>
          </View>
          <View style={ic.controlCol}>
            <Pressable style={({ pressed }) => [ic.acceptBtn, pressed && ic.pressed]} onPress={handleAccept}>
              <Feather name="phone" size={28} color={colors.white} />
            </Pressable>
            <Text style={ic.controlLabel}>Accept</Text>
          </View>
        </View>
      </View>
    </ImageBackground>
  );
};

const ic = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#475569',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
  },
  avatarText: { color: colors.white, fontSize: 44, fontWeight: '700' },
  name: { color: colors.white, fontSize: 28, fontWeight: '700', marginTop: 24, textAlign: 'center', maxWidth: '100%' },
  subtitle: { color: '#1D9E75', fontSize: 14, fontWeight: '600', marginTop: 8 },
  controls: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 20 },
  controlCol: { alignItems: 'center', gap: 10 },
  declineBtn: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: '#C0392B',
    alignItems: 'center', justifyContent: 'center',
  },
  acceptBtn: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: '#1A6B4A',
    alignItems: 'center', justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  controlLabel: { color: '#CBD5E1', fontSize: 13, fontWeight: '600' },
});

export default IncomingCallScreen;

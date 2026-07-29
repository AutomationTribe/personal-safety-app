import React, { useEffect, useRef, useState } from 'react';
import { Animated, ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppStackParamList } from '../../navigation/AppNavigator';
import { endFakeCall } from '../../services/FakeCallKeepService';
import { colors } from '../../styles/tokens';

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const ActiveCallScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const route = useRoute<RouteProp<AppStackParamList, 'ActiveCall'>>();
  const { callerName, callUUID } = route.params;

  const [elapsed, setElapsed] = useState(0);
  const pulse = useRef(new Animated.Value(0.6)).current;
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.6, duration: 1200, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  const handleEndCall = () => {
    if (callUUID) endFakeCall(callUUID);
    navigation.navigate('Home');
  };

  // Safety net — if this screen unmounts some other way (e.g. a future
  // navigation change) while a native CallKeep session is still open, make
  // sure the telecom call gets torn down instead of lingering.
  useEffect(() => {
    return () => {
      if (callUUID) endFakeCall(callUUID);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ImageBackground
      source={require('../../../assets/call-screen-bg.png')}
      style={ac.root}
      resizeMode="cover"
    >
      <View style={[ac.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}>
        <View style={ac.top}>
          <Text style={ac.name} numberOfLines={1}>{callerName}</Text>
          <Text style={ac.subtitle}>Hadin Safety Call</Text>
        </View>

        <Animated.View style={[ac.timerWrap, { opacity: pulse }]}>
          <Text style={ac.timer}>{formatElapsed(elapsed)}</Text>
        </Animated.View>

        <View style={ac.midControls}>
          <View style={ac.controlCol}>
            <Pressable
              style={({ pressed }) => [ac.iconBtn, muted && ac.iconBtnActive, pressed && ac.pressed]}
              onPress={() => setMuted((m) => !m)}
            >
              <Feather name="mic-off" size={22} color={colors.white} />
            </Pressable>
            <Text style={ac.controlLabel}>Mute</Text>
          </View>
          <View style={ac.controlCol}>
            <Pressable
              style={({ pressed }) => [ac.iconBtn, speaker && ac.iconBtnActive, pressed && ac.pressed]}
              onPress={() => setSpeaker((s) => !s)}
            >
              <Feather name="volume-2" size={22} color={colors.white} />
            </Pressable>
            <Text style={ac.controlLabel}>Speaker</Text>
          </View>
        </View>

        <View style={ac.controlCol}>
          <Pressable style={({ pressed }) => [ac.endBtn, pressed && ac.pressed]} onPress={handleEndCall}>
            <Feather name="phone-off" size={30} color={colors.white} />
          </Pressable>
          <Text style={ac.controlLabel}>End Call</Text>
        </View>
      </View>
    </ImageBackground>
  );
};

const ac = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
  },
  top: { alignItems: 'center' },
  name: { color: colors.white, fontSize: 24, fontWeight: '700', textAlign: 'center', maxWidth: '100%' },
  subtitle: { color: '#94A3B8', fontSize: 13, marginTop: 6 },
  timerWrap: { alignItems: 'center' },
  timer: { color: colors.white, fontSize: 40, fontWeight: '300', letterSpacing: 1 },
  midControls: { flexDirection: 'row', gap: 40 },
  controlCol: { alignItems: 'center', gap: 10 },
  iconBtn: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#334155',
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnActive: { backgroundColor: '#475569' },
  endBtn: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#C0392B',
    alignItems: 'center', justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  controlLabel: { color: '#CBD5E1', fontSize: 13, fontWeight: '600' },
});

export default ActiveCallScreen;

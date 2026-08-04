import React from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';

interface HadinLogoProps {
  size?: number;
  style?: StyleProp<ImageStyle>;
}

const HadinLogo = ({ size = 34, style }: HadinLogoProps) => (
  <Image
    source={require('../../assets/hadin-login-logo.png')}
    style={[{ width: size, height: size }, style]}
    resizeMode="contain"
  />
);

export default HadinLogo;

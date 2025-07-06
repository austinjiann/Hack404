import React from 'react';
import { Pressable, View } from 'react-native';

interface CameraButtonProps {
  onPress: () => void;
  style?: any;
}

// Simple camera icon: two concentric circles and a rectangle (lens)
export default function CameraButton({ onPress, style }: CameraButtonProps) {
  return (
    <Pressable onPress={onPress} style={[{ justifyContent: 'center', alignItems: 'center', width: 56, height: 56 }, style]}>
      <View style={{
        width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#2196F3', backgroundColor: 'white', justifyContent: 'center', alignItems: 'center',
      }}>
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#2196F3' }} />
      </View>
    </Pressable>
  );
}

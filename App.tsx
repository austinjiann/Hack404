import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Dimensions, Text, Pressable, Alert, ActivityIndicator } from 'react-native';
import MapView, { Marker, Circle } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';

export default function App() {
  const [location, setLocation] = useState<null | { latitude: number; longitude: number }>(null);
  const [loading, setLoading] = useState(true);
  const [dangerZone, setDangerZone] = useState<{ latitude: number; longitude: number } | null>(null);
  // Slider goes from 0 to 100, mapped exponentially to radius 10m-400m
  const [sliderValue, setSliderValue] = useState(10);
  const minRadius = 10;
  const maxRadius = 400;
  const [radius, setRadius] = useState(minRadius);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission to access location was denied');
        setLoading(false);
        return;
      }
      let loc = await Location.getCurrentPositionAsync({});
      setLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      setDangerZone({
        latitude: loc.coords.latitude + 0.001,
        longitude: loc.coords.longitude,
      });
      setLoading(false);
    })();
  }, []);

  const handleReport = () => {
    Alert.alert('Danger zone reported!');
  };

  // Exponential mapping for slider: small values change radius less, large values change radius more
  const sliderToRadius = (val: number) => {
    // Exponential scale: r = min * (max/min)^(val/100)
    return Math.round(minRadius * Math.pow(maxRadius / minRadius, val / 100));
  };
  const radiusToSlider = (r: number) => {
    return Math.round(100 * Math.log(r / minRadius) / Math.log(maxRadius / minRadius));
  };

  if (loading || !location || !dangerZone) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}> 
        <ActivityIndicator size="large" color="#d32f2f" />
        <Text>Loading map...</Text>
      </View>
    );
  }

  // Keep marker draggable and update position
  const handleMarkerDrag = (e: any) => {
    setDangerZone(e.nativeEvent.coordinate);
  };

  // Update radius when slider changes
  const handleSliderChange = (val: number) => {
    setSliderValue(val);
    setRadius(sliderToRadius(val));
  };

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        showsUserLocation={true}
      >
        <Marker
          coordinate={dangerZone}
          pinColor="red"
          draggable
          onDragEnd={handleMarkerDrag}
        />
        <Circle
          center={dangerZone}
          radius={radius}
          strokeColor="#d32f2f"
          fillColor="rgba(211,47,47,0.2)"
        />
      </MapView>
      <Pressable style={styles.reportButton} onPress={handleReport}>
        <Text style={styles.reportButtonText}>🚩 Report</Text>
      </Pressable>
      <View style={styles.sliderContainer}>
        <Text style={styles.sliderLabel}>Radius: {radius}m</Text>
        <Slider
          style={{width: 200, height: 40}}
          minimumValue={0}
          maximumValue={100}
          step={1}
          value={sliderValue}
          minimumTrackTintColor="#d32f2f"
          maximumTrackTintColor="#000000"
          onValueChange={handleSliderChange}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sliderContainer: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 220,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    alignItems: 'center',
  },
  sliderLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#d32f2f',
    marginBottom: 8,
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  map: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  reportButton: {
    position: 'absolute',
    bottom: 40,
    right: 20,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#d32f2f',
    flexDirection: 'row',
    alignItems: 'center',
  },
  reportButtonText: {
    color: '#d32f2f',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

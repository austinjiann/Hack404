import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Dimensions, Text, Pressable, Alert, ActivityIndicator } from 'react-native';
import DescriptionModal from './DescriptionModal';
import MapView, { Marker, Circle } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';
import { ref, push, onValue, set } from 'firebase/database';
import { realtimeDb } from './firebaseRealtime';
import type { DangerZone } from './types';

export default function App() {
  const [location, setLocation] = useState<null | { latitude: number; longitude: number }>(null);
  const [loading, setLoading] = useState(true);
  const [dangerZone, setDangerZone] = useState<{ latitude: number; longitude: number } | null>(null);
  // Slider goes from 0 to 100, mapped exponentially to radius 10m-400m
  const [sliderValue, setSliderValue] = useState(10);
  const minRadius = 10;
  const maxRadius = 400;
  const [radius, setRadius] = useState(minRadius);
  const [descModalVisible, setDescModalVisible] = useState(false);
  const [description, setDescription] = useState<string>('');
  const [descDraft, setDescDraft] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [dangerZones, setDangerZones] = useState<any[]>([]); // All fetched danger zones

  // Helper for bounding box query
  const getBoundingBox = (center: { latitude: number; longitude: number }, delta: number) => {
    return {
      minLat: center.latitude - delta,
      maxLat: center.latitude + delta,
      minLng: center.longitude - delta,
      maxLng: center.longitude + delta,
    };
  };

  // Real-time Realtime Database listener for all danger zones (subscribe once)
  useEffect(() => {
    const dbRef = ref(realtimeDb, 'danger_zones');
    const listener = onValue(dbRef, (snapshot) => {
      const data = snapshot.val() || {};
      const allZones: DangerZone[] = Object.keys(data).map(id => ({ id, ...data[id] }));
      setDangerZones(allZones);
    });
    return () => listener();
  }, []);

  // Filter danger zones by location on every render
  const filteredDangerZones = React.useMemo(() => {
    if (!location) return dangerZones;
    const delta = 0.02;
    const { minLat, maxLat, minLng, maxLng } = getBoundingBox(location, delta);
    return dangerZones.filter((z: any) =>
      z.latitude >= minLat && z.latitude <= maxLat &&
      z.longitude >= minLng && z.longitude <= maxLng
    );
  }, [dangerZones, location]);

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

  const handleReport = async () => {
    if (!dangerZone) return;
    setSubmitting(true);
    try {
      const dbRef = ref(realtimeDb, 'danger_zones');
      await push(dbRef, {
        latitude: dangerZone.latitude,
        longitude: dangerZone.longitude,
        radius,
        description,
        timestamp: Date.now(),
      });
      Alert.alert('Danger zone reported!' + (description ? `\nDescription: ${description}` : ''));
      // Reset state for new report
      setDescription('');
      setDescDraft('');
      // Move marker to a new position (e.g., offset slightly)
      setDangerZone({
        latitude: location!.latitude + (Math.random() - 0.5) * 0.002,
        longitude: location!.longitude + (Math.random() - 0.5) * 0.002,
      });
      setSliderValue(10);
      setRadius(minRadius);
    } catch (err) {
      Alert.alert('Error reporting danger zone', String(err));
    } finally {
      setSubmitting(false);
    }
  };


  const handleDescriptionSubmit = (desc: string) => {
    setDescription(desc);
  };

  // Exponential mapping for slider: small values change radius less, large values change radius more
  const sliderToRadius = (val: number) => {
    // Exponential scale: r = min * (max/min)^(val/100)
    return Math.round(minRadius * Math.pow(maxRadius / minRadius, val / 100));
  };
  const radiusToSlider = (r: number) => {
    return Math.round(100 * Math.log(r / minRadius) / Math.log(maxRadius / minRadius));
  };

  if (loading) {
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
        initialRegion={location ? {
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        } : {
          latitude: 37.78825, // Default to San Francisco
          longitude: -122.4324,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation={true}
        // No need for onRegionChangeComplete fetch, real-time updates handle this
      >
         {/* User's marker for new report (green) */}
         {dangerZone && (
           <Marker
             coordinate={dangerZone}
             pinColor="green"
             draggable
             onDragEnd={handleMarkerDrag}
             hitSlop={{ top: 80, bottom: 80, left: 80, right: 80 }}
             tracksViewChanges={false}
           />
         )}
         {dangerZone && (
           <Circle
             center={dangerZone}
             radius={radius}
             strokeColor="#2ecc40"
             fillColor="rgba(46,204,64,0.2)"
           />
         )}
         {/* Show all reported danger zones from Firestore */}
         {dangerZones.map(z => {
           // Compute age in ms
           const now = Date.now();
           // For Realtime DB, z.timestamp is ms since epoch
           const ts = typeof z.timestamp === 'number' ? z.timestamp : 0;
           const ageMs = now - ts;
           const maxAgeMs = 12 * 60 * 60 * 1000; // 12 hours
           if (ageMs > maxAgeMs) return null; // Hide if older than 12 hours

           // Compute color: red (0) -> orange (6h) -> yellow (12h)
           // 0h: #d32f2f (red), 6h: #ffa500 (orange), 12h: #fff200 (yellow)
           const colorStops = [
             { t: 0, color: [211, 47, 47] },        // red
             { t: 0.5, color: [255, 165, 0] },      // orange
             { t: 1, color: [255, 242, 0] },        // yellow
           ];
           const t = Math.min(1, Math.max(0, ageMs / maxAgeMs));
           let color = [211, 47, 47];
           for (let i = 1; i < colorStops.length; ++i) {
             if (t <= colorStops[i].t) {
               const t0 = colorStops[i - 1].t, t1 = colorStops[i].t;
               const frac = (t - t0) / (t1 - t0);
               color = colorStops[i - 1].color.map((c, idx) => Math.round(c + frac * (colorStops[i].color[idx] - c)));
               break;
             }
           }
           const rgb = `rgb(${color[0]},${color[1]},${color[2]})`;
           const rgba = `rgba(${color[0]},${color[1]},${color[2]},0.2)`;
           return (
             <React.Fragment key={z.id}>
               <Marker
                 coordinate={{ latitude: z.latitude, longitude: z.longitude }}
                 pinColor={rgb}
                 title={z.description ? z.description : 'Danger Zone'}
               />
               <Circle
                 center={{ latitude: z.latitude, longitude: z.longitude }}
                 radius={z.radius || 40}
                 strokeColor={rgb}
                 fillColor={rgba}
               />
             </React.Fragment>
           );
         })}
      </MapView>
      <View style={styles.bottomButtonRow}>
        <Pressable style={styles.descButton} onPress={() => {
          setDescDraft(description);
          setDescModalVisible(true);
        }}>
          <Text style={styles.descButtonText}>📝 Add Description</Text>
        </Pressable>
        <Pressable style={styles.reportButton} onPress={handleReport}>
          <Text style={styles.reportButtonText}>🚩 Report</Text>
        </Pressable>
      </View>
      <DescriptionModal
        visible={descModalVisible}
        onClose={() => setDescModalVisible(false)}
        onSubmit={(desc) => { setDescription(desc); setDescModalVisible(false); }}
        initialValue={descDraft}
      />
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
  bottomButtonRow: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  descButton: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#1976d2',
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  descButtonText: {
    color: '#1976d2',
    fontWeight: 'bold',
    fontSize: 16,
    marginRight: 2,
  },
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
    flex: 1,
    marginLeft: 10,
  },
  reportButtonText: {
    color: '#d32f2f',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

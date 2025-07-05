import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Dimensions, Text, Pressable, Alert, ActivityIndicator, PanResponder, Animated } from 'react-native';
import DescriptionModal from './DescriptionModal';
import MapView, { Marker, Circle } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';
import { ref, push, onValue, set } from 'firebase/database';
import { realtimeDb } from './firebaseRealtime';
import type { DangerZone } from './types';

export default function App() {
  const [location, setLocation] = useState<null | { latitude: number; longitude: number }>(null);
  const [cameraLocation, setCameraLocation] = useState<null | { latitude: number; longitude: number }>(null);
  const locationRef = useRef(location);
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
  const [joystickActive, setJoystickActive] = useState(false);
  const joystickRadius = 40; // px
  const moveStep = 0.001; // ~100m per tick, noticeable
  const pan = React.useRef(new Animated.ValueXY()).current;
  const joystickPos = useRef({ x: 0, y: 0 }); // Track current joystick position
  const moveInterval = useRef<NodeJS.Timeout | null>(null); // Timer for continuous movement
  const mapRef = useRef(null);
  const [joystickAngle, setJoystickAngle] = useState(0);

  // Helper for bounding box query
  const getBoundingBox = (center: { latitude: number; longitude: number }, delta: number) => {
    return {
      minLat: center.latitude - delta,
      maxLat: center.latitude + delta,
      minLng: center.longitude - delta,
      maxLng: center.longitude + delta,
    };
  };

  // Real-time Realtime Database listener for all danger zones
  useEffect(() => {
    const dbRef = ref(realtimeDb, 'danger_zones');
    const listener = onValue(dbRef, (snapshot) => {
      const data = snapshot.val() || {};
      const allZones: DangerZone[] = Object.keys(data).map(id => ({ id, ...data[id] }));
      let filtered = allZones;
      if (location) {
        const delta = 0.02;
        const { minLat, maxLat, minLng, maxLng } = getBoundingBox(location, delta);
        filtered = allZones.filter((z: any) =>
          z.latitude >= minLat && z.latitude <= maxLat &&
          z.longitude >= minLng && z.longitude <= maxLng
        );
      } else {
        // If no location, show all (or limit to a wide box)
        filtered = allZones;
      }
      setDangerZones(filtered);
    });
    return () => listener();
  }, [location]);

  // Set initial location from GPS only once
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
      setCameraLocation({
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

  // Keep locationRef in sync with location
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  // Delayed camera follow effect
  useEffect(() => {
    if (!location) return;
    const timeout = setTimeout(() => {
      setCameraLocation(location);
    }, 1000); // 1 second delay
    return () => clearTimeout(timeout);
  }, [location]);

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

  // Joystick pan responder
  const panResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setJoystickActive(true);
        pan.setValue({ x: 0, y: 0 });
        joystickPos.current = { x: 0, y: 0 };
        // Start movement interval
        if (moveInterval.current) clearInterval(moveInterval.current);
        moveInterval.current = setInterval(() => {
          const { x, y } = joystickPos.current;
          const distance = Math.sqrt(x * x + y * y);
          if (locationRef.current && distance > 0) { // Lowered threshold
            const angle = Math.atan2(y, x);
            setJoystickAngle(angle);
            const speed = 0.000025; // Constant, slow walk-like speed
            const dLat = -Math.sin(angle) * speed;
            const dLng = Math.cos(angle) * speed;
            setLocation(loc => {
              const newLoc = loc ? {
                latitude: loc.latitude + dLat,
                longitude: loc.longitude + dLng,
              } : loc;
              return newLoc;
            });
          }
        }, 16); // ~60fps
      },
      onPanResponderMove: (e, gesture) => {
        // Clamp the knob to the joystick base radius
        const dx = gesture.dx;
        const dy = gesture.dy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        let clampedX = dx;
        let clampedY = dy;
        if (distance > joystickRadius) {
          const angle = Math.atan2(dy, dx);
          clampedX = Math.cos(angle) * joystickRadius;
          clampedY = Math.sin(angle) * joystickRadius;
        }
        pan.setValue({ x: clampedX, y: clampedY });
        joystickPos.current = { x: clampedX, y: clampedY }; // Update current joystick position
        if (clampedX !== 0 || clampedY !== 0) {
          setJoystickAngle(Math.atan2(clampedY, clampedX));
        }
      },
      onPanResponderRelease: () => {
        setJoystickActive(false);
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        joystickPos.current = { x: 0, y: 0 };
        if (moveInterval.current) {
          clearInterval(moveInterval.current);
          moveInterval.current = null;
        }
      },
    })
  ).current;

  // Center the map on the blue dot as it moves
  useEffect(() => {
    if (mapRef.current && cameraLocation) {
      mapRef.current.animateToRegion({
        latitude: cameraLocation.latitude,
        longitude: cameraLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 1000);
    }
  }, [cameraLocation]);

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
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        scrollEnabled={!joystickActive}
        pitchEnabled={!joystickActive}
        rotateEnabled={!joystickActive}
        zoomEnabled={!joystickActive}
      >
        {/* Custom blue dot marker for user location */}
        <Marker coordinate={location} anchor={{x:0.5, y:0.5}}>
          <View style={styles.gmapsBlueDotOuter}>
            <View style={styles.gmapsBlueDotInner} />
          </View>
        </Marker>
        {/* User's marker for new report (green) */}
        <Marker
          coordinate={dangerZone}
          pinColor="green"
          draggable
          onDragEnd={handleMarkerDrag}
          hitSlop={{ top: 80, bottom: 80, left: 80, right: 80 }}
          tracksViewChanges={false}
        />
        <Circle
          center={dangerZone}
          radius={radius}
          strokeColor="#2ecc40"
          fillColor="rgba(46,204,64,0.2)"
        />
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
      {/* Joystick overlay */}
      <View style={styles.joystickContainer} pointerEvents="box-none">
        <View style={styles.joystickBase}>
          <Animated.View
            style={[
              styles.joystickKnob,
              {
                transform: [
                  { translateX: pan.x },
                  { translateY: pan.y },
                ],
              },
            ]}
            {...panResponder.panHandlers}
          />
        </View>
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
  joystickContainer: {
    position: 'absolute',
    bottom: 120,
    left: 40,
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  joystickBase: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(136,136,136,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  joystickKnob: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#888',
    position: 'absolute',
    left: 20,
    top: 20,
  },
  gmapsBlueDotOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#1976d2',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  gmapsBlueDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1976d2',
    borderWidth: 1.5,
    borderColor: 'white',
  },
});

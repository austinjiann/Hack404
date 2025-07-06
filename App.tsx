import React, { useEffect, useState, useRef, useCallback } from 'react';
import Markdown from 'react-native-markdown-display';
import { StyleSheet, View, Dimensions, Text, Pressable, Alert, ActivityIndicator, PanResponder, Animated, Platform, Modal, Image } from 'react-native';
import DescriptionModal from './DescriptionModal';
import CameraButton from './CameraButton';
import * as ImagePicker from 'expo-image-picker';
import MapView, { Marker, Circle, Region, Polyline } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';
import { ref, push, onValue, set } from 'firebase/database';
import * as Notifications from 'expo-notifications';
import { realtimeDb } from './firebaseRealtime';
import type { DangerZone } from './types';
import { storage } from './firebaseStorage';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getSafeWalkingRoute } from './osrm';
import { getOfflineSafeRoute } from './offlineRouter';
import { gemini } from './gemini';

export default function App() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null); // For modal display

  const [showMarkerModal, setShowMarkerModal] = useState(false);
  const [selectedMarkerDescription, setSelectedMarkerDescription] = useState<string>('');
  const [location, setLocation] = useState<null | { latitude: number; longitude: number }>(null);
  const [cameraLocation, setCameraLocation] = useState<null | { latitude: number; longitude: number }>(null);
  const locationRef = useRef(location);
  const [loading, setLoading] = useState(true);
  const [dangerZone, setDangerZone] = useState<{ latitude: number; longitude: number } | null>(null);
  // Slider goes from 0 to 100, mapped exponentially to radius 10m-400m
  const [sliderValue, setSliderValue] = useState(0);
  const minRadius = 50;
  const maxRadius = 800;
  const [radius, setRadius] = useState(minRadius);
  const [descModalVisible, setDescModalVisible] = useState(false);
  const [description, setDescription] = useState<string>('');
  const [descDraft, setDescDraft] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [dangerZones, setDangerZones] = useState<any[]>([]); // All fetched danger zones
  const [nearbyDescriptions, setNearbyDescriptions] = useState<string[]>([]); // Descriptions within 400m
  const [summaryModalVisible, setSummaryModalVisible] = useState(false);
  const [geminiSummary, setGeminiSummary] = useState<string>('');

  const [joystickActive, setJoystickActive] = useState(false);
  const joystickRadius = 40; // px
  const moveStep = 0.001; // ~100m per tick, noticeable
  const pan = React.useRef(new Animated.ValueXY()).current;
  const joystickPos = useRef({ x: 0, y: 0 }); // Track current joystick position
  const moveInterval = useRef<NodeJS.Timeout | null>(null); // Timer for continuous movement
  const mapRef = useRef<MapView>(null);
  const [lastRegion, setLastRegion] = useState<any>(null);
  const [joystickAngle, setJoystickAngle] = useState(0);

  // Store the initial GPS location for reset
  const initialLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);

  const [destination, setDestination] = useState<{ latitude: number; longitude: number } | null>(null);
  const [safePath, setSafePath] = useState<{ latitude: number; longitude: number }[] | null>(null);
  const [isCalculatingPath, setIsCalculatingPath] = useState(false);
  // Workaround: force refresh after path is found
  const [refreshKey, setRefreshKey] = useState(0);
  // New: Track if user is in destination-setting mode
  const [isSettingDestination, setIsSettingDestination] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const pathCalculationTimeout = useRef<NodeJS.Timeout | null>(null);

// --- Notification/intersection helpers ---
function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
const enteredZoneIds = React.useRef<Set<string>>(new Set());
// Track last notification time globally
const lastNotificationTime = React.useRef<number>(0);

  // Marker refresh workaround (less disruptive)
  const [markerRefresh, setMarkerRefresh] = useState(0);
  useEffect(() => {
    // Always trigger a marker refresh when dangerZones changes
    const t = setTimeout(() => setMarkerRefresh(f => f + 1), 500);
    return () => clearTimeout(t);
  }, [dangerZones]);

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

  // Set initial location from GPS only once
  useEffect(() => {
    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      // If notification permissions are not granted, do nothing (no Alert, rely on shouldShowBanner)
      if (status !== 'granted') {
        // Optionally, you can log or handle this silently
      }
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    })();
  }, []);

  // --- Danger zone intersection notification ---
  useEffect(() => {
    if (!location || dangerZones.length === 0) return;
    const now = Date.now();
    for (const zone of dangerZones) {
      const dist = getDistanceMeters(
        location.latitude,
        location.longitude,
        zone.latitude,
        zone.longitude
      );
      const r = zone.radius || 20;
      if (dist <= r) {
        if (!enteredZoneIds.current.has(zone.id) && now - lastNotificationTime.current >= 10000) {
          enteredZoneIds.current.add(zone.id);
          lastNotificationTime.current = now;
          Notifications.scheduleNotificationAsync({
            content: {
              title: '⚠️ Danger Zone Alert',
              body: 'You just entered a danger zone!',
              sound: true,
            },
            trigger: null,
          });
        }
      } else {
        enteredZoneIds.current.delete(zone.id);
      }
    }
  }, [location, dangerZones]);

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
      initialLocationRef.current = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
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
    let photoUrl = null;
    try {
      // Upload image if selected
      if (selectedImage) {
        const response = await fetch(selectedImage);
        const blob = await response.blob();
        const fileName = `dangerzone_${Date.now()}.jpg`;
        const imgRef = storageRef(storage, `dangerzone_photos/${fileName}`);
        await uploadBytes(imgRef, blob);
        photoUrl = await getDownloadURL(imgRef);
      }
      const dbRef = ref(realtimeDb, 'danger_zones');
      await push(dbRef, {
        latitude: dangerZone.latitude,
        longitude: dangerZone.longitude,
        radius,
        description,
        timestamp: Date.now(),
        photoUrl,
      });
      Alert.alert('Danger zone reported!' + (description ? `\nDescription: ${description}` : ''));
      // Reset state for new report
      setDescription('');
      setDescDraft('');
      setSelectedImage(null);
      // Move marker to a new position (e.g., offset slightly)
      setDangerZone({
        latitude: location!.latitude + (Math.random() - 0.5) * 0.002,
        longitude: location!.longitude + (Math.random() - 0.5) * 0.002,
      });
      setSliderValue(50);
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

  // Handler for reset position
  const handleResetPosition = () => {
    if (initialLocationRef.current) {
      setLocation({ ...initialLocationRef.current });
      setCameraLocation({ ...initialLocationRef.current });
    }
  };

  // Handle map press for routing
  const handleMapPress = async (e: any) => {
    // Only allow setting destination if in destination-setting mode
    if (!isSettingDestination) return;
    setIsSettingDestination(false); // Exit destination mode after one use
    const tapped = e.nativeEvent.coordinate;
    setDestination(tapped);
    setSafePath(null);
    if (!location) return;

    // Cancel routing if either the destination or the starting point are within a danger zone
    const isInDangerZone = (point: { latitude: number; longitude: number }) => {
      return dangerZones.some(z => {
        const dist = getDistanceMeters(point.latitude, point.longitude, z.latitude, z.longitude);
        const r = z.radius || 40;
        return dist <= r;
      });
    };
    if (isInDangerZone(location) || isInDangerZone(tapped)) {
      Alert.alert('Danger Zone', 'Cannot route: Start or destination is inside a danger zone.');
      setIsCalculatingPath(false);
      setPathError('Start or destination is inside a danger zone.');
      return;
    }

    setIsCalculatingPath(true);
    setPathError(null);

    try {
      // Prepare zones array once
      const zonesArr = dangerZones.map(z => ({
        latitude: z.latitude,
        longitude: z.longitude,
        radius: z.radius || 40,
      }));

      // Try offline router first for instant local path
      let route: { latitude: number; longitude: number }[] | null = null;
      try {
        route = getOfflineSafeRoute(location, tapped, zonesArr);
      } catch {
      // graph missing or corrupt
    }

    if (!route) {
      route = await getSafeWalkingRoute(location, tapped, zonesArr);
    }

    if (!route) {
      setPathError('No route found');
      setSafePath(null);
      Alert.alert(
        'Route Finding',
        'Could not find a walking route to your destination. The location might not be accessible by foot.'
      );
      return;
    }

    setSafePath(route);
    setRefreshKey(k => k + 1); // Force refresh workaround
    } catch (error) {
      console.error('Path calculation error:', error);
      setPathError('Network error - please try again');
      setSafePath(null);
      Alert.alert(
        'Connection Error',
        'Failed to calculate route. Please check your internet connection and try again.'
      );
    } finally {
      setIsCalculatingPath(false);
    }
  };

  // Handle destination marker drag
  const handleMarkerDragEnd = (e: any) => {
    setDestination(e.nativeEvent.coordinate);
    setSafePath(null); // Clear existing path
  };

  // Clear route handler
  const clearRoute = () => {
    setDestination(null);
    setSafePath(null);
    setPathError(null);
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}> 
        <View style={styles.loadingCard}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
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
    <View key={refreshKey} style={styles.container}>
      {/* Camera Button - bottom left, floating */}
      {/* Preview thumbnail if image selected */}
      {selectedImage && (
        <View style={{ position: 'absolute', bottom: 170, left: 24, zIndex: 11 }}>
          <View style={{ width: 56, height: 56, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: '#2196F3', backgroundColor: 'white' }}>
            <Image source={{ uri: selectedImage }} style={{ width: 56, height: 56, borderRadius: 8 }} />
            <Pressable onPress={() => setSelectedImage(null)} style={{ position: 'absolute', top: 0, right: 0, zIndex: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
              <Text style={{ color: '#2196F3', fontWeight: 'bold', fontSize: 18, backgroundColor: 'white', borderRadius: 12, width: 24, height: 24, textAlign: 'center', lineHeight: 22 }}>×</Text>
            </Pressable>
          </View>
        </View>
      )}
      <CameraButton
        onPress={async () => {
          // Ask for permissions
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Camera permission is required!');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            allowsEditing: true,
            quality: 0.7,
            base64: false,
          });
          if (!result.canceled && result.assets && result.assets.length > 0) {
            setSelectedImage(result.assets[0].uri);
          }
        }}
        style={{
          position: 'absolute',
          bottom: 120,
          left: 24,
          zIndex: 10,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 4,
          elevation: 6,
        }}
      />
      {/* Reset Position Button */}
      <View style={styles.resetButtonContainer}>
        <Pressable style={styles.resetButton} onPress={handleResetPosition}>
          <Text style={styles.resetButtonText}>Reset Position</Text>
        </Pressable>
      </View>
      <MapView
        key={markerRefresh}
        ref={mapRef}
        style={styles.map}
        region={lastRegion || (location ? {
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        } : {
          latitude: 37.78825, // Default to San Francisco
          longitude: -122.4324,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        })}
        onRegionChangeComplete={setLastRegion}
        scrollEnabled={!joystickActive}
        pitchEnabled={!joystickActive}
        rotateEnabled={!joystickActive}
        zoomEnabled={!joystickActive}
        onPress={handleMapPress}
      >
         {/* Custom blue dot marker for user location */}
         {location && (
          <Marker coordinate={location} anchor={{x:0.5, y:0.5}}>
            <View style={styles.gmapsBlueDotOuter}>
              <View style={styles.gmapsBlueDotInner} />
            </View>
          </Marker>
        )}
          {/* Render all red markers/circles first */}
          {filteredDangerZones.filter(z => {
            if (!dangerZone) return true;
            const dist = getDistanceMeters(z.latitude, z.longitude, dangerZone.latitude, dangerZone.longitude);
            return dist > 10;
          }).map(z => {
            // Compute age in ms
            const now = Date.now();
            const ts = typeof z.timestamp === 'number' ? z.timestamp : 0;
            const ageMs = now - ts;
            const maxAgeMs = 12 * 60 * 60 * 1000; // 12 hours
            if (ageMs > maxAgeMs) return null;
            const colorStops = [
              { t: 0, color: [211, 47, 47] },
              { t: 0.5, color: [255, 165, 0] },
              { t: 1, color: [255, 242, 0] },
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
              <React.Fragment key={z.id || `${z.latitude},${z.longitude},${z.timestamp}`}>
                <Marker
                  coordinate={{ latitude: z.latitude, longitude: z.longitude }}
                  pinColor={rgb}
                  onPress={() => {
                    setSelectedMarkerDescription(z.description || 'No description provided.');
                    setShowMarkerModal(true);
                  }}
                  zIndex={1}
                />
                <Circle
                  center={{ latitude: z.latitude, longitude: z.longitude }}
                  radius={z.radius || 40}
                  strokeColor={rgb}
                  fillColor={rgba}
                  zIndex={1}
                />
              </React.Fragment>
            );
          })}
          {dangerZone && (
            <React.Fragment>
              <Marker
                coordinate={dangerZone}
                pinColor="green"
                draggable
                onDragEnd={handleMarkerDrag}
                hitSlop={{ top: 80, bottom: 80, left: 80, right: 80 }}
                tracksViewChanges={false}
                zIndex={1001}
              />
              <Circle
                center={dangerZone}
                radius={radius}
                strokeColor="#2ecc40"
                fillColor="rgba(46,204,64,0.2)"
                zIndex={1000}
              />
            </React.Fragment>
          )}
          {/* Draggable destination marker */}
          {destination && (
            <Marker
              coordinate={destination}
              pinColor="#9C27B0" // purple
              title="Destination"
              draggable
              onDragEnd={handleMarkerDragEnd}
            />
          )}
          {/* Safe path visualization */}
          {safePath && (
            <Polyline
              coordinates={safePath}
              strokeColor="#2196F3"
              strokeWidth={3}
              lineDashPattern={[5, 5]}
            />
          )}
      </MapView>

      {/* Danger Zone Description Modal */}
      <Modal
        visible={showMarkerModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMarkerModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 24, maxWidth: 320, alignItems: 'center' }}>
            <Text style={{ fontWeight: 'bold', fontSize: 18, marginBottom: 12 }}>Danger Zone Description</Text>
            <Text style={{ fontSize: 16, color: '#444', marginBottom: 20, textAlign: 'center' }}>{selectedMarkerDescription}</Text>
            {/* Show image if present in modal */}
            {filteredDangerZones.find(z => z.description === selectedMarkerDescription && z.photoUrl) && (
              <Image
                source={{ uri: filteredDangerZones.find(z => z.description === selectedMarkerDescription)?.photoUrl }}
                style={{ width: 180, height: 180, borderRadius: 16, marginBottom: 16, marginTop: 8, borderWidth: 2, borderColor: '#2196F3' }}
                resizeMode="cover"
              />
            )}
            <Pressable onPress={() => setShowMarkerModal(false)} style={{ paddingVertical: 8, paddingHorizontal: 20, backgroundColor: '#2196F3', borderRadius: 8 }}>
              <Text style={{ color: 'white', fontWeight: 'bold' }}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Rest of the UI: radius slider, action bar, joystick, description modal */}
      <View style={styles.sliderCard}>
        <Text style={styles.radiusValue}>{radius}m</Text>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={100}
          step={1}
          value={sliderValue}
          minimumTrackTintColor="#2196F3"
          maximumTrackTintColor="rgba(0,0,0,0.1)"
          thumbTintColor="#2196F3"
          onValueChange={handleSliderChange}
        />
      </View>

      {/* Bottom Action Bar */}
      <View style={styles.bottomActionBar}>
        {/* Fetch Descriptions Button */}
      {/* Summary Description (vertical stack, lower right, above Report button) */}
      <View style={{ position: 'absolute', right: 20, bottom: 90, zIndex: 21, alignItems: 'flex-end', width: 160 }} pointerEvents="box-none">
        <Pressable
          style={({ pressed }) => [
            { backgroundColor: '#ede7f6', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28, borderColor: '#673ab7', borderWidth: 2, minHeight: 48, minWidth: 140, alignItems: 'center', justifyContent: 'center', shadowColor: '#673ab7', shadowOpacity: 0.07, shadowRadius: 10, elevation: 2 },
            pressed && { opacity: 0.9 }
          ]}
          onPress={async () => {
            if (!location) return;
            // Get all danger zones within 400m
            const zones = dangerZones.filter(z => {
              return getDistanceMeters(z.latitude, z.longitude, location.latitude, location.longitude) <= 400;
            });
            // Gather descriptions, images, and timestamps
            const descriptions = zones.map(z => z.description ?? '');
            const images = zones.map(z => z.photoUrl ?? '');
            const timestamps = zones.map(z => z.timestamp ?? null);
            setNearbyDescriptions(zones.map(z => [z.description, z.timestamp, z.photoUrl]));

            // Compose the Gemini prompt
            const prompt = `Based on the provided list of descriptions and images of danger zones in the area 100m around you, summarize all of them into one condensed short description of what is happening. If the entire list is filled with empty strings but is not completely empty, (just the empty strings), still warn of a potential danger nearby. But, if it is just an empty list, don't warn of any danger and say no danger zones reported recently. Finally, conclude how high the risk is based on timestamp (how long ago it was) and how many danger zones there are. You can include if most of the danger zones are old or if they are recent to explain why the risk level is high or low. 
            
            The description should consist of 2 separate sections: 1) A short description of what is happening along with a couple of examples of danger zones, and 2) A conclusion on the risk level. The format for this should always be the same. Have the headings of "Description" and "Risk Level" in bold. Use space between each section. Use markdown to format. Don't use numbers to enumerate sections. Don't have an overall title for the summary. 
            
            Do NOT include any additional information on timestamps or specific values or calculations you used to determine your findings. Keep the summary concise and to the point. \n\nDescriptions: ${JSON.stringify(descriptions)}\nImages: ${JSON.stringify(images)}\nTimestamps: ${JSON.stringify(timestamps)}\nCurrent time (ms since epoch): ${Date.now()}`;

            try {
              setGeminiSummary('Loading summary...');
              setSummaryModalVisible(true);
              const response = await gemini.models.generateContent({
                model: 'gemini-2.0-flash-001',
                contents: prompt,
              });
              const summary = response.text || JSON.stringify(response);
              setGeminiSummary(summary);
            } catch (err) {
              setGeminiSummary('Gemini API Error: ' + String(err));
            }
          }}
        >
          <Text style={{ color: '#673ab7', fontWeight: 'bold', fontSize: 16, marginBottom: 2 }}>Zone Summary</Text>
        </Pressable>
      </View>

      {/* Gemini Summary Modal */}
      <Modal
        visible={summaryModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSummaryModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: 'white', borderRadius: 18, padding: 28, maxWidth: 420, width: '90%', maxHeight: '80%', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontWeight: 'bold', fontSize: 20, color: '#673ab7', marginBottom: 16, alignSelf: 'center' }}>Gemini Danger Zone Summary</Text>
            <View style={{ width: '100%', backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 20 }}>
              <Markdown style={{ body: { fontSize: 16, color: '#333', textAlign: 'left' } }}>{geminiSummary}</Markdown>
            </View>
            <Pressable style={{ alignSelf: 'center', backgroundColor: '#673ab7', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 32, marginTop: 6 }} onPress={() => setSummaryModalVisible(false)}>
              <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Bottom Action Bar */}
      <View style={[styles.bottomActionBar, { marginBottom: -23 }]}> {/* Keep Describe/Report at the very bottom */}
        <Pressable 
          style={({pressed}) => [
            styles.actionButton,
            styles.descButton,
            pressed && styles.buttonPressed
          ]} 
          onPress={() => {
            setDescDraft(description);
            setDescModalVisible(true);
          }}
        >
          <Text style={styles.actionButtonIcon}>📝</Text>
          <Text style={[styles.actionButtonText, styles.descButtonText]}>Describe it</Text>
        </Pressable>

        <Pressable 
          style={({pressed}) => [
            styles.actionButton,
            styles.reportButton,
            pressed && styles.buttonPressed
          ]} 
          onPress={handleReport}
        >
          <Text style={styles.actionButtonIcon}>⚠️</Text>
          <Text style={[styles.actionButtonText, styles.reportButtonText]}>Report Zone</Text>
        </Pressable>
      </View>
      </View>

      {/* Joystick */}
      <View style={[styles.joystickContainer, { marginBottom: 5 }]} pointerEvents="box-none">
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

      <DescriptionModal
        visible={descModalVisible}
        onClose={() => setDescModalVisible(false)}
        onSubmit={(desc) => { setDescription(desc); setDescModalVisible(false); }}
        initialValue={descDraft}
      />

      {/* Route control panel */}
      {destination ? (
        <View style={[styles.routePanel, { marginBottom: 140 }]}>
          <View style={styles.routeInfo}>
            <Text style={styles.routeTitle}>
              {isCalculatingPath ? '🔄 Calculating Route...' :
               pathError ? '⚠️ ' + pathError :
               safePath ? '🚶‍♂️ Safe Route Found' :
               '📍 Select Destination'}
            </Text>
            <Text style={styles.routeSubtitle}>
              {isCalculatingPath ? 'Finding the safest path...' : 
               pathError ? 'Try a different destination' : 
               safePath ? 'Following roads and avoiding dangers' :
               'Tap map or drag marker'}
            </Text>
          </View>
          <Pressable
            style={styles.clearRouteButton}
            onPress={clearRoute}
          >
            <Text style={styles.clearRouteButtonText}>Clear</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.routePanel, { marginBottom: 140 }]}>
          <View style={styles.routeInfo}>
            <Text style={styles.routeTitle}>
              {isSettingDestination ? 'Tap the map to select your destination' : 'Ready to set a destination?'}
            </Text>
            <Text style={styles.routeSubtitle}>
              {isSettingDestination ? 'Tap anywhere on the map to choose where you want to go.' : 'Press the button below to begin.'}
            </Text>
          </View>
          <Pressable
            style={[styles.clearRouteButton, isSettingDestination && { backgroundColor: '#1976d2' }]}
            onPress={() => setIsSettingDestination(v => !v)}
          >
            <Text style={[styles.clearRouteButtonText, isSettingDestination && { color: 'white' }]}>Set Destination</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingCard: {
    backgroundColor: 'white',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  map: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  sliderCard: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 14,
    width: 240,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  sliderLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 2,
  },
  radiusValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2196F3',
    marginBottom: 4,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  bottomActionBar: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  actionButtonIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  descButton: {
    borderWidth: 2,
    borderColor: '#2196F3',
  },
  descButtonText: {
    color: '#2196F3',
  },
  reportButton: {
    backgroundColor: '#2196F3',
  },
  reportButtonText: {
    color: 'white',
  },
  joystickContainer: {
    position: 'absolute',
    bottom: 120,
    left: 40,
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  joystickBase: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.1)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  joystickKnob: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#2196F3',
    position: 'absolute',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  gmapsBlueDotOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#2196F3',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.35,
        shadowRadius: 6,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  gmapsBlueDotInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#2196F3',
    borderWidth: 2,
    borderColor: 'white',
  },
  resetButtonContainer: {
    position: 'absolute',
    top: 70,
    left: 20,
    zIndex: 100,
  },
  resetButton: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 12,
    shadowColor: '#1976d2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1.2,
    borderColor: '#1976d2',
    alignItems: 'center',
  },
  resetButtonText: {
    color: '#1976d2',
    fontWeight: 'bold',
    fontSize: 13,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  routePanel: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  routeInfo: {
    flex: 1,
    marginRight: 16,
  },
  routeTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  routeSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  clearRouteButton: {
    backgroundColor: '#ff5252',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  clearRouteButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});

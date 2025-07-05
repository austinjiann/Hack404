import React from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import MapView, { Polygon } from 'react-native-maps';

export default function App() {
  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: 37.78825,
          longitude: -122.4324,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        }}
      >
        <Polygon
          coordinates={[
            { latitude: 37.78925, longitude: -122.4324 },
            { latitude: 37.78925, longitude: -122.4224 },
            { latitude: 37.78425, longitude: -122.4224 },
            { latitude: 37.78425, longitude: -122.4324 },
          ]}
          fillColor="rgba(255,0,0,0.5)"
          strokeColor="rgba(255,0,0,1)"
          strokeWidth={2}
        />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  map: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
});

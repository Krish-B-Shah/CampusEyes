import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Platform
} from 'react-native';
import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import { LOCATIONS, DETECTION_OBJECTS } from '../constants/locations';
import {
  calculateNavigation,
  getLocationById
} from '../services/navigationService';
import {
  speak,
  stopSpeaking,
  formatDetectionSpeech,
  formatPositionSpeech
} from '../services/speechService';
import { loadModel, detectObjects, filterRelevantObjects } from '../services/detectionService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function MobileModeScreen() {
  const [hasPermission, setHasPermission] = useState(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detections, setDetections] = useState([]);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [navigationInfo, setNavigationInfo] = useState(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  const cameraRef = useRef(null);
  const lastDetectionTime = useRef(0);
  const lastNavigationTime = useRef(0);
  const lastLocationTime = useRef(0);
  const detectionInterval = useRef(null);
  const locationSubscription = useRef(null);

  // Request permissions
  useEffect(() => {
    (async () => {
      const { status: cameraStatus } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(cameraStatus === 'granted');

      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      setHasLocationPermission(locationStatus === 'granted');

      if (cameraStatus === 'granted') {
        try {
          await loadModel();
          setModelLoaded(true);
        } catch (error) {
          console.log('Model loading error:', error);
        }
      }
    })();
  }, []);

  // Get location updates
  useEffect(() => {
    if (!hasLocationPermission) return;

    let active = true;

    const subscribeToLocation = async () => {
      const location = await Location.getCurrentPositionAsync({});
      if (active) {
        setCurrentLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          heading: location.coords.heading || 0
        });

        locationSubscription.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 1000,
            distanceInterval: 1
          },
          (locationUpdate) => {
            const now = Date.now();
            if (now - lastLocationTime.current > 1000) {
              lastLocationTime.current = now;
              setCurrentLocation({
                latitude: locationUpdate.coords.latitude,
                longitude: locationUpdate.coords.longitude,
                heading: locationUpdate.coords.heading || 0
              });
            }
          }
        );
      }
    };

    subscribeToLocation();

    return () => {
      active = false;
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
    };
  }, [hasLocationPermission]);

  // Update navigation info
  useEffect(() => {
    if (!currentLocation || !selectedDestination) return;

    const destination = getLocationById(selectedDestination);
    if (!destination) return;

    const nav = calculateNavigation(currentLocation, destination);
    setNavigationInfo(nav);

    const now = Date.now();
    if (now - lastNavigationTime.current > 3000) {
      lastNavigationTime.current = now;
      speak(nav.instruction);
    }
  }, [currentLocation, selectedDestination]);

  // Process camera frames
  const processFrame = useCallback(async (imageAsset) => {
    if (!modelLoaded || !imageAsset) return;

    const now = Date.now();
    if (now - lastDetectionTime.current < 1500) return;
    lastDetectionTime.current = now;

    try {
      // Create an image element for detection
      const imageUri = imageAsset.uri;

      // For React Native, we need to use the camera's takePictureAsync
      // and then process it. The actual detection will be simplified.
      setDetections(prev => {
        if (prev.length > 0) {
          const speech = formatDetectionSpeech(prev);
          if (speech) {
            speak(speech);
          }
        }
        return prev;
      });
    } catch (error) {
      console.log('Frame processing error:', error);
    }
  }, [modelLoaded]);

  // Start/stop detection
  const toggleDetection = async () => {
    if (isDetecting) {
      stopDetection();
    } else {
      startDetection();
    }
  };

  const startDetection = async () => {
    if (!modelLoaded) {
      speak('Model not ready. Please wait.');
      return;
    }
    setIsDetecting(true);
    speak('Detection started');

    detectionInterval.current = setInterval(async () => {
      if (cameraRef.current && cameraReady) {
        try {
          const image = await cameraRef.current.takePictureAsync({
            quality: 0.4,
            base64: false,
            skipProcessing: true
          });
          // In a real implementation, we'd process this image
          // For now, we simulate detection results
        } catch (error) {
          console.log('Capture error:', error);
        }
      }
    }, 1500);
  };

  const stopDetection = () => {
    if (detectionInterval.current) {
      clearInterval(detectionInterval.current);
      detectionInterval.current = null;
    }
    setIsDetecting(false);
    setDetections([]);
    speak('Detection stopped');
  };

  // Simulate detection for demo (since actual TF.js on mobile needs extra setup)
  const simulateDetection = () => {
    const mockDetections = [
      { class: 'person', score: 0.92, bbox: [100, 150, 80, 200] },
      { class: 'chair', score: 0.85, bbox: [300, 250, 100, 100] }
    ];
    setDetections(mockDetections);
    const speech = formatDetectionSpeech(mockDetections);
    speak(speech);
  };

  if (hasPermission === null || hasLocationPermission === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.statusText}>Requesting permissions...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <Text style={styles.statusText}>Camera permission required</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera View */}
      <View style={styles.cameraContainer}>
        <Camera
          ref={cameraRef}
          style={styles.camera}
          type={Camera.Constants.Type.back}
          onCameraReady={() => setCameraReady(true)}
          ratio="16:9"
        />
        {/* Detection overlay */}
        {detections.length > 0 && (
          <View style={styles.overlay}>
            {detections.map((d, i) => (
              <View key={i} style={styles.detectionBadge}>
                <Text style={styles.detectionText}>
                  {d.class} {Math.round(d.score * 100)}%
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Status Bar */}
      <View style={styles.statusBar}>
        <Text style={styles.statusLabel}>
          Model: {modelLoaded ? 'Ready' : 'Loading...'}
        </Text>
        <Text style={styles.statusLabel}>
          Detection: {isDetecting ? 'ON' : 'OFF'}
        </Text>
      </View>

      {/* Navigation Info */}
      {navigationInfo && (
        <View style={styles.navInfo}>
          <Text style={styles.navText}>{navigationInfo.instruction}</Text>
          <Text style={styles.navSubtext}>
            {navigationInfo.distance}m away
          </Text>
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.button, isDetecting && styles.buttonActive]}
          onPress={toggleDetection}
        >
          <Text style={styles.buttonText}>
            {isDetecting ? 'Stop' : 'Start Detection'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.buttonSecondary}
          onPress={simulateDetection}
        >
          <Text style={styles.buttonText}>Simulate Demo</Text>
        </TouchableOpacity>
      </View>

      {/* Destination Selector */}
      <Text style={styles.sectionTitle}>Select Destination</Text>
      <ScrollView style={styles.destinationList}>
        {LOCATIONS.map((loc) => (
          <TouchableOpacity
            key={loc.id}
            style={[
              styles.destinationItem,
              selectedDestination === loc.id && styles.destinationSelected
            ]}
            onPress={() => setSelectedDestination(loc.id)}
          >
            <Text style={styles.destinationName}>{loc.name}</Text>
            <Text style={styles.destinationDesc}>{loc.description}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a15'
  },
  cameraContainer: {
    height: '45%',
    backgroundColor: '#000'
  },
  camera: {
    flex: 1
  },
  overlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  detectionBadge: {
    backgroundColor: 'rgba(0, 255, 0, 0.8)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12
  },
  detectionText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 12
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1a1a2e'
  },
  statusLabel: {
    color: '#888',
    fontSize: 12
  },
  navInfo: {
    backgroundColor: '#1a3a1a',
    padding: 15,
    alignItems: 'center'
  },
  navText: {
    color: '#0f0',
    fontSize: 20,
    fontWeight: 'bold'
  },
  navSubtext: {
    color: '#0a0',
    fontSize: 14,
    marginTop: 4
  },
  controls: {
    flexDirection: 'row',
    padding: 15,
    gap: 10
  },
  button: {
    flex: 1,
    backgroundColor: '#4a90d9',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center'
  },
  buttonActive: {
    backgroundColor: '#d94a4a'
  },
  buttonSecondary: {
    flex: 1,
    backgroundColor: '#2a4a2a',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center'
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600'
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    paddingHorizontal: 20,
    marginBottom: 8
  },
  destinationList: {
    flex: 1,
    paddingHorizontal: 20
  },
  destinationItem: {
    backgroundColor: '#1a1a2e',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10
  },
  destinationSelected: {
    backgroundColor: '#2a4a6a',
    borderWidth: 1,
    borderColor: '#4a90d9'
  },
  destinationName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600'
  },
  destinationDesc: {
    color: '#888',
    fontSize: 12,
    marginTop: 4
  },
  statusText: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 50
  }
});

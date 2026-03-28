import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { LOCATIONS } from '../constants/locations';
import {
  calculateNavigation,
  getLocationById,
  buildWalkGraph,
  getRouteSteps
} from '../services/navigationService';
import USF_MAP from '../../assets/USF_Map.json';
import {
  speak,
  stopSpeaking
} from '../services/speechService';
import { analyzeScene } from '../services/detectionService';

export default function MobileModeScreen() {
  const [hasPermission, requestCameraPermission] = useCameraPermissions();
  const [hasLocationPermission, setHasLocationPermission] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [navigationInfo, setNavigationInfo] = useState(null);
  const [routeSteps, setRouteSteps] = useState([]);
  const [routeStepIndex, setRouteStepIndex] = useState(0);
  const [destinationLocation, setDestinationLocation] = useState(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [currentMode, setCurrentMode] = useState('navigate');

  const cameraRef = useRef(null);
  const lastNavigationTime = useRef(0);
  const lastLocationTime = useRef(0);
  const analysisInterval = useRef(null);
  const locationSubscription = useRef(null);

  // Build walk graph from campus GeoJSON
  useEffect(() => {
    try {
      buildWalkGraph(USF_MAP);
    } catch (err) {
      console.warn('Failed to build map graph:', err);
    }
  }, []);

  // Request permissions
  useEffect(() => {
    (async () => {
      if (hasPermission === null) {
        await requestCameraPermission();
      }

      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      setHasLocationPermission(locationStatus === 'granted');

    })();
  }, []);

  // Get location updates
  useEffect(() => {
    if (!hasLocationPermission) return;

    let active = true;

    const subscribeToLocation = async () => {
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
          timeout: 15000,
          maximumAge: 1000
        });

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
      } catch (error) {
        console.warn('Location access error:', error);
        setErrorMessage('Location unavailable: ' + (error.message || 'Timed out'));
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

  // Update navigation info and path instructions
  useEffect(() => {
    if (!currentLocation || !selectedDestination) return;

    const destination = getLocationById(selectedDestination);
    if (!destination) return;

    setDestinationLocation(destination);

    const nav = calculateNavigation(currentLocation, destination);
    setNavigationInfo(nav);

    // Recompute path steps from current location to destination
    const steps = getRouteSteps(currentLocation, {
      latitude: destination.latitude,
      longitude: destination.longitude,
      name: destination.name
    });
    setRouteSteps(steps);
    setRouteStepIndex(0);

    const now = Date.now();
    if (now - lastNavigationTime.current > 3000) {
      lastNavigationTime.current = now;
      speak(nav.instruction);
    }
  }, [currentLocation, selectedDestination]);

  useEffect(() => {
    if (routeSteps.length === 0) return;
    const current = routeSteps[Math.min(routeStepIndex, routeSteps.length - 1)];
    if (!current) return;
    speak(current.text);
  }, [routeSteps, routeStepIndex]);

  const analyzeCurrentScene = async () => {
    if (!cameraRef.current || !cameraReady) return;

    try {
      const image = await cameraRef.current.takePictureAsync({
        quality: 0.5,
        base64: false,
        skipProcessing: true
      });

      if (image && image.uri) {
        const destination = selectedDestination ? getLocationById(selectedDestination) : null;

        const result = await analyzeScene({
          imageUri: image.uri,
          mode: currentMode,
          destination: destination?.name || null,
        });

        setAnalysisResult(result);
        speak(result);
      }
    } catch (error) {
      console.error('Analysis error:', error);
      setErrorMessage('Analysis failed. Please try again.');
    }
  };

  // Start/stop analysis
  const toggleAnalysis = async () => {
    if (isAnalyzing) {
      stopAnalysis();
    } else {
      startAnalysis();
    }
  };

  const startAnalysis = async () => {
    if (!cameraReady) {
      setErrorMessage('Camera not ready. Please wait.');
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage(null);
    speak('Scene analysis started');

    // Initial analysis
    await analyzeCurrentScene();

    // Set up continuous analysis every 15 seconds (5 per minute limit)
    analysisInterval.current = setInterval(async () => {
      await analyzeCurrentScene();
    }, 15000);
  };

  const stopAnalysis = () => {
    if (analysisInterval.current) {
      clearInterval(analysisInterval.current);
      analysisInterval.current = null;
    }
    setIsAnalyzing(false);
    stopSpeaking();
    speak('Scene analysis stopped');
  };

  const modeLabels = {
    navigate: 'Navigate',
    read: 'Read Text',
    identify: 'Identify',
    panic: 'Help!',
    followup: 'Follow-up'
  };

  if (hasPermission === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.statusText}>Requesting permissions...</Text>
      </View>
    );
  }

  if (!hasPermission?.granted || hasLocationPermission === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.statusText}>Camera and location permissions required</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera View */}
      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          onCameraReady={() => setCameraReady(true)}
          ratio="16:9"
        />
        {/* Analysis status overlay */}
        {isAnalyzing && (
          <View style={styles.analyzingBadge}>
            <Text style={styles.analyzingText}>ANALYZING</Text>
          </View>
        )}
      </View>

      {/* Status Bar */}
      <View style={styles.statusBar}>
        <Text style={styles.statusLabel}>
          Mode: {modeLabels[currentMode] || 'Navigate'}
        </Text>
        <Text style={styles.statusLabel}>
          {isAnalyzing ? 'LIVE' : 'STOPPED'}
        </Text>
      </View>

      {/* Error message */}
      {errorMessage && (
        <View style={styles.errorInfo}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      )}

      {/* Navigation Info */}
      {navigationInfo && (
        <View style={styles.navInfo}>
          <Text style={styles.navText}>{navigationInfo.instruction}</Text>
          <Text style={styles.navSubtext}>
            {navigationInfo.distance}m away
          </Text>
        </View>
      )}

      {/* Analysis Result */}
      {analysisResult && (
        <ScrollView style={styles.resultContainer}>
          <Text style={styles.resultText}>{analysisResult}</Text>
        </ScrollView>
      )}

      {/* Mode Selector */}
      <View style={styles.modeSelector}>
        <Text style={styles.modeLabel}>Mode:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.modeScroll}>
          {Object.entries(modeLabels).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[
                styles.modeButton,
                currentMode === key && styles.modeButtonActive
              ]}
              onPress={() => setCurrentMode(key)}
            >
              <Text style={[
                styles.modeButtonText,
                currentMode === key && styles.modeButtonTextActive
              ]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.button, isAnalyzing && styles.buttonActive]}
          onPress={toggleAnalysis}
        >
          <Text style={styles.buttonText}>
            {isAnalyzing ? 'Stop Analysis' : 'Start Analysis'}
          </Text>
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
    height: '35%',
    backgroundColor: '#000'
  },
  camera: {
    flex: 1
  },
  analyzingBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#d94a4a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8
  },
  analyzingText: {
    color: '#fff',
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
  resultContainer: {
    maxHeight: 150,
    padding: 15,
    backgroundColor: '#1a1a2e',
    marginHorizontal: 20,
    borderRadius: 10,
    marginTop: 10
  },
  resultText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20
  },
  modeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 10
  },
  modeLabel: {
    color: '#888',
    fontSize: 12
  },
  modeScroll: {
    flexDirection: 'row'
  },
  modeButton: {
    backgroundColor: '#2a2a3e',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    marginRight: 8
  },
  modeButtonActive: {
    backgroundColor: '#4a90d9'
  },
  modeButtonText: {
    color: '#888',
    fontSize: 12
  },
  modeButtonTextActive: {
    color: '#fff',
    fontWeight: '600'
  },
  controls: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 10,
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
  },
  errorInfo: {
    padding: 10,
    backgroundColor: 'rgba(255, 0, 0, 0.2)',
    marginHorizontal: 20,
    borderRadius: 8,
    marginTop: 10
  },
  errorText: {
    color: '#fff',
    fontSize: 13,
    textAlign: 'center'
  }
});

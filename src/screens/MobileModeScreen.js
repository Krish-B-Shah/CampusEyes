import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, Alert
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
import { speak, stopSpeaking } from '../services/speechService';
import { calculateNavigation, getLocationById } from '../services/navigationService';
import { LOCATIONS } from '../constants/locations';

const MODES = ['navigate', 'read', 'identify'];
const MODE_LABELS = { navigate: '🧭 Navigate', read: '📖 Read', identify: '🔍 Identify' };

export default function MobileModeScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [locationPermission, setLocationPermission] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [navigationInfo, setNavigationInfo] = useState(null);
  const [routeSteps, setRouteSteps] = useState([]);
  const [routeStepIndex, setRouteStepIndex] = useState(0);
  const [destinationLocation, setDestinationLocation] = useState(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [currentMode, setCurrentMode] = useState('navigate');
  const [isScanning, setIsScanning] = useState(false);
  const [lastResponse, setLastResponse] = useState('');
  const [conversationHistory, setConversationHistory] = useState([]);
  const [lastImageBase64, setLastImageBase64] = useState(null);
  const [memoryContext, setMemoryContext] = useState(null);
  const [communityHazards, setCommunityHazards] = useState([]);
  const [navigationInfo, setNavigationInfo] = useState(null);
  const [isListening, setIsListening] = useState(false);

  const cameraRef = useRef(null);
  const navIntervalRef = useRef(null);

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
    requestCameraPermission();
    requestLocationPermission();
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
    return () => clearInterval(navIntervalRef.current);
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
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: false,
      });

      const response = await analyzeScene({
        imageUri: photo.uri,
        mode: currentMode,
        conversationHistory,
        memoryContext,
        communityHazards,
        destination: selectedDestination
          ? getLocationById(selectedDestination)?.name
          : null,
      });

      setLastResponse(response);
      speak(response, true);

      // Save to conversation history for follow-ups
      setConversationHistory(prev => [
        ...prev,
        {
          role: 'user',
          parts: [{ text: `[Scene scanned in ${currentMode} mode]` }]
        },
        {
          role: 'model',
          parts: [{ text: response }]
        }
      ]);

    } catch (err) {
      console.error('Scan error:', err);
      speak('Scan failed. Please try again.');
    } finally {
      setIsScanning(false);
    }
  };

  // --- VOICE FOLLOW-UP ---
  // Person 2 will pass memoryContext and communityHazards as props/state
  // This function handles text follow-ups (voice recognition can be added)
  const handleFollowUp = async (question) => {
    if (!lastResponse) {
      speak('Please scan first before asking a question.');
      return;
    }

    const response = await analyzeScene({
      imageUri: null, // no new image needed
      mode: 'followup',
      conversationHistory,
      memoryContext,
      communityHazards,
      destination: selectedDestination
        ? getLocationById(selectedDestination)?.name
        : null,
      userQuestion: question,
    });

    setLastResponse(response);
    speak(response, true);

    setConversationHistory(prev => [
      ...prev,
      { role: 'user', parts: [{ text: question }] },
      { role: 'model', parts: [{ text: response }] }
    ]);
  };

  // --- PANIC BUTTON ---
  const handlePanic = async () => {
    if (!cameraRef.current) return;
    speak('Locating you now. Please hold still.', true);
    setIsScanning(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      const response = await analyzeScene({
        imageUri: photo.uri,
        mode: 'panic',
        conversationHistory: [],
        memoryContext,
        communityHazards,
        destination: selectedDestination
          ? getLocationById(selectedDestination)?.name
          : null,
      });

      setLastResponse(response);
      speak(response, true);
      setConversationHistory([]);
    } catch (err) {
      speak('Could not locate you. Please try again.');
    } finally {
      setIsScanning(false);
    }
  };

  // --- EXPOSE SETTERS FOR PERSON 2 INTEGRATION ---
  // Person 2 will call these from their service layer:
  // setMemoryContext(memoryString)
  // setCommunityHazards(hazardsArray)

  if (!cameraPermission) return <View style={styles.container}><Text style={styles.text}>Requesting permissions...</Text></View>;
  if (!cameraPermission.granted) return (
    <View style={styles.container}>
      <Text style={styles.text}>Camera access required for CampusEyes.</Text>
      <TouchableOpacity style={styles.button} onPress={requestCameraPermission}>
        <Text style={styles.buttonText}>Grant Camera Access</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>

      {/* CAMERA */}
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      </View>

      {/* MODE TOGGLE */}
      <View style={styles.modeRow}>
        {MODES.map(mode => (
          <TouchableOpacity
            key={mode}
            style={[styles.modeButton, currentMode === mode && styles.modeButtonActive]}
            onPress={() => setCurrentMode(mode)}
          >
            <Text style={[styles.modeText, currentMode === mode && styles.modeTextActive]}>
              {MODE_LABELS[mode]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* RESPONSE */}
      <ScrollView style={styles.responseBox}>
        <Text style={styles.responseText}>
          {lastResponse || 'Tap Scan to analyze your surroundings.'}
        </Text>
      </ScrollView>

      {/* NAVIGATION INFO */}
      {navigationInfo && (
        <View style={styles.navBanner}>
          <Text style={styles.navText}>
            {navigationInfo.instruction} ({Math.round(navigationInfo.distance)}m)
          </Text>
        </View>
      )}

      {/* COMMUNITY HAZARD BANNER */}
      {communityHazards.length > 0 && (
        <View style={styles.hazardBanner}>
          <Text style={styles.hazardText}>
            ⚠️ {communityHazards[0].description} reported nearby
          </Text>
        </View>
      )}

      {/* MAIN SCAN BUTTON */}
      <TouchableOpacity
        style={[styles.scanButton, isScanning && styles.scanButtonDisabled]}
        onPress={handleScan}
        disabled={isScanning}
        accessibilityLabel="Scan surroundings"
        accessibilityRole="button"
      >
        <Text style={styles.scanButtonText}>
          {isScanning ? 'Scanning...' : '👁️ SCAN'}
        </Text>
      </TouchableOpacity>

      {/* PANIC BUTTON */}
      <TouchableOpacity
        style={styles.panicButton}
        onPress={handlePanic}
        accessibilityLabel="I am lost, help me"
      >
        <Text style={styles.panicText}>🆘 I'M LOST</Text>
      </TouchableOpacity>

      {/* DESTINATION SELECTOR */}
      <ScrollView horizontal style={styles.destinationRow}>
        {LOCATIONS.map(loc => (
          <TouchableOpacity
            key={loc.id}
            style={[
              styles.destButton,
              selectedDestination === loc.id && styles.destButtonActive
            ]}
            onPress={() => {
              setSelectedDestination(loc.id);
              speak(`Navigating to ${loc.name}`);
            }}
          >
            <Text style={styles.destText}>{loc.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  text: { color: '#fff', fontSize: 18, textAlign: 'center', margin: 20 },
  cameraContainer: { flex: 1, maxHeight: 300 },
  camera: { flex: 1 },
  modeRow: { flexDirection: 'row', justifyContent: 'space-around', padding: 8, backgroundColor: '#111' },
  modeButton: { padding: 8, borderRadius: 8, backgroundColor: '#222' },
  modeButtonActive: { backgroundColor: '#2563eb' },
  modeText: { color: '#aaa', fontSize: 13 },
  modeTextActive: { color: '#fff', fontWeight: 'bold' },
  responseBox: { maxHeight: 120, backgroundColor: '#111', margin: 8, borderRadius: 8, padding: 10 },
  responseText: { color: '#fff', fontSize: 15, lineHeight: 22 },
  navBanner: { backgroundColor: '#1d4ed8', padding: 8, margin: 8, borderRadius: 8 },
  navText: { color: '#fff', fontSize: 14, textAlign: 'center' },
  hazardBanner: { backgroundColor: '#dc2626', padding: 8, margin: 8, borderRadius: 8 },
  hazardText: { color: '#fff', fontSize: 14, textAlign: 'center' },
  scanButton: { backgroundColor: '#2563eb', margin: 12, padding: 20, borderRadius: 16, alignItems: 'center' },
  scanButtonDisabled: { backgroundColor: '#555' },
  scanButtonText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  panicButton: { backgroundColor: '#dc2626', margin: 12, marginTop: 0, padding: 14, borderRadius: 16, alignItems: 'center' },
  panicText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  destinationRow: { paddingHorizontal: 8, paddingBottom: 8, maxHeight: 60 },
  destButton: { backgroundColor: '#222', padding: 10, borderRadius: 8, marginRight: 8, minWidth: 100, alignItems: 'center' },
  destButtonActive: { backgroundColor: '#065f46' },
  destText: { color: '#fff', fontSize: 13 },
  button: { backgroundColor: '#2563eb', padding: 16, margin: 20, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { analyzeScene } from '../services/detectionService';
import { speak, stopSpeaking } from '../services/speechService';
import { listenOnce } from '../services/voiceService';
import { calculateNavigation, getLocationById } from '../services/navigationService';
import { saveLocationMemory, getLocationMemory, formatMemoryContext } from '../services/memoryService';
import { getNearbyHazards, reportHazard, subscribeToHazards } from '../services/hazardService';
import { LOCATIONS } from '../constants/locations';

const MODES = ['navigate', 'read', 'identify'];
const MODE_ICONS  = { navigate: '🧭', read: '📖', identify: '🔍' };
const MODE_LABELS = { navigate: 'NAVIGATE', read: 'READ', identify: 'IDENTIFY' };

const COMMANDS_HELP = `Available commands: Say "navigate" to switch to navigation mode. Say "read" to read text. Say "identify" to identify objects. Say "scan" to analyze your surroundings. Say "where am I" to repeat the last result. Say "help" to hear commands again.`;

const HAZARD_TYPES = [
  'Wet floor',
  'Obstacle blocking path',
  'Broken elevator',
  'Construction ahead',
  'Crowded hallway',
];

export default function MobileModeScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [locationPermission, setLocationPermission] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [currentMode, setCurrentMode] = useState('navigate');
  const [isScanning, setIsScanning] = useState(false);
  const [lastResponse, setLastResponse] = useState('Tap the microphone and say a command — like "scan" or "navigate"');
  const [conversationHistory, setConversationHistory] = useState([]);
  const [memoryContext, setMemoryContext] = useState(null);
  const [communityHazards, setCommunityHazards] = useState([]);
  const [navigationInfo, setNavigationInfo] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [lastHeard, setLastHeard] = useState('');

  const cameraRef = useRef(null);
  const navIntervalRef = useRef(null);
  const hazardUnsubscribeRef = useRef(null);
  const firstLocationLoaded = useRef(false);

  // ─── PERMISSIONS ──────────────────────────────────────────────────────────
  useEffect(() => {
    requestCameraPermission();
    requestLocationPermission();
    return () => {
      if (hazardUnsubscribeRef.current) hazardUnsubscribeRef.current();
    };
  }, []);

  const requestLocationPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      setLocationPermission(true);
      startLocationTracking();
    }
  };

  const startLocationTracking = async () => {
    await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 2 },
      async (loc) => {
        const coords = loc.coords;
        setCurrentLocation(coords);

        // ── First location: load memory + start hazard subscription ──
        if (!firstLocationLoaded.current) {
          firstLocationLoaded.current = true;

          // Load memory for this location
          const memory = await getLocationMemory(coords.latitude, coords.longitude);
          setMemoryContext(formatMemoryContext(memory));

          // Start real-time hazard subscription
          hazardUnsubscribeRef.current = subscribeToHazards(
            coords.latitude,
            coords.longitude,
            (newHazard) => {
              setCommunityHazards(prev => [...prev, newHazard]);
              speak(`Warning — ${newHazard.description} reported nearby.`, true);
            }
          );

          // Load initial nearby hazards
          const hazards = await getNearbyHazards(coords.latitude, coords.longitude);
          setCommunityHazards(hazards);
        }
      }
    );
  };

  // ─── ANNOUNCE MODE ON CHANGE ───────────────────────────────────────────────
  useEffect(() => {
    speak(`Now in ${currentMode} mode. Say "scan" to analyze.`);
  }, [currentMode]);

  // ─── NAVIGATION UPDATES ────────────────────────────────────────────────────
  useEffect(() => {
    if (navIntervalRef.current) clearInterval(navIntervalRef.current);
    if (currentLocation && selectedDestination) {
      navIntervalRef.current = setInterval(() => {
        const dest = getLocationById(selectedDestination);
        if (!dest) return;
        const info = calculateNavigation(currentLocation, dest);
        setNavigationInfo(info);
        if (info) speak(info.instruction);
      }, 4000);
    }
    return () => clearInterval(navIntervalRef.current);
  }, [currentLocation, selectedDestination]);

  // ─── VOICE COMMAND HANDLER ─────────────────────────────────────────────────
  const handleVoiceCommand = useCallback(({ command, args }) => {
    switch (command) {
      case 'navigate':
        setCurrentMode('navigate');
        speak('Switched to navigate mode.');
        break;
      case 'read':
        setCurrentMode('read');
        speak('Switched to read mode.');
        break;
      case 'identify':
        setCurrentMode('identify');
        speak('Switched to identify mode.');
        break;
      case 'scan':
        handleScan();
        break;
      case 'repeat':
        if (lastResponse) speak(lastResponse, true);
        else speak('No previous result to repeat. Say "scan" first.');
        break;
      case 'help':
        speak(COMMANDS_HELP, true);
        break;
      case 'panic':
        handlePanic();
        break;
      case 'stop':
        stopSpeaking();
        break;
      case 'destination': {
        const heard = (args[0] || '').toLowerCase();
        setLastHeard(heard);
        // Match against location names and short aliases
        const match = LOCATIONS.find(loc => {
          const full = loc.name.toLowerCase();
          const short = loc.id.toLowerCase();
          // Try to match "library", "en b", "engineer", etc.
          const words = heard.split(/\s+/);
          return words.some(w => full.includes(w) || w.includes(loc.id));
        });
        if (match) {
          setSelectedDestination(match.id);
          speak(`Navigating to ${match.name}.`);
        } else {
          speak(`Did not recognize a destination. Try tapping a location below.`);
        }
        break;
      }
      default:
        if (command === 'error') {
          speak('Microphone error. Please try again.');
        }
        break;
    }
  }, [currentMode, lastResponse, selectedDestination]);

  // ─── VOICE TAP ────────────────────────────────────────────────────────────
  const handleMicTap = async () => {
    if (isListening) return;
    setLastHeard('');
    await listenOnce(
      (cmd) => { handleVoiceCommand(cmd); },
      (listening) => setIsListening(listening)
    );
  };

  // ─── MAIN SCAN ─────────────────────────────────────────────────────────────
  const handleScan = async () => {
    if (!cameraRef.current || isScanning) return;
    setIsScanning(true);
    stopSpeaking();
    speak('Scanning...');

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

      // ── After scan: save memory + refresh hazards ──
      if (currentLocation) {
        await saveLocationMemory(
          currentLocation.latitude,
          currentLocation.longitude,
          response
        );
        const memory = await getLocationMemory(
          currentLocation.latitude,
          currentLocation.longitude
        );
        setMemoryContext(formatMemoryContext(memory));

        const hazards = await getNearbyHazards(
          currentLocation.latitude,
          currentLocation.longitude
        );
        setCommunityHazards(hazards);
      }

    } catch (err) {
      console.error('Scan error:', err);
      const msg = 'Scan failed. Please try again.';
      setLastResponse(msg);
      speak(msg);
    } finally {
      setIsScanning(false);
    }
  };

  // ─── PANIC BUTTON ──────────────────────────────────────────────────────────
  const handlePanic = async () => {
    if (!cameraRef.current) return;
    stopSpeaking();
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

  // ─── HAZARD REPORTING ──────────────────────────────────────────────────────
  const handleReportHazard = async (description) => {
    if (!currentLocation) {
      speak('Cannot report hazard without location access.');
      return;
    }
    await reportHazard(
      currentLocation.latitude,
      currentLocation.longitude,
      description
    );
    speak(`Reported: ${description}. Thank you for helping other students.`);
  };

  // ─── MODE SWITCH (tap) ─────────────────────────────────────────────────────
  const handleModeTap = (mode) => {
    if (isScanning) return;
    setCurrentMode(mode);
  };

  // ─── PERMISSION STATES ─────────────────────────────────────────────────────
  if (!cameraPermission) return (
    <View style={styles.container}>
      <Text style={styles.permissionText}>Requesting permissions...</Text>
    </View>
  );

  if (!cameraPermission.granted) return (
    <View style={styles.container}>
      <Text style={styles.permissionText}>Camera access required for CampusEyes.</Text>
      <TouchableOpacity style={styles.permissionButton} onPress={requestCameraPermission}>
        <Text style={styles.permissionButtonText}>Grant Camera Access</Text>
      </TouchableOpacity>
    </View>
  );

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>

      {/* ── TOP STATUS BAR ── */}
      <View style={styles.statusBar}>
        <View style={[styles.micIndicator, isListening && styles.micIndicatorActive]}>
          <Text style={styles.micIcon}>🎙️</Text>
          <Text style={styles.micLabel}>{isListening ? 'Listening...' : 'Ready'}</Text>
        </View>

        <View style={styles.modeBadge}>
          <Text style={styles.modeBadgeText}>
            {MODE_ICONS[currentMode]} {MODE_LABELS[currentMode]}
          </Text>
        </View>
      </View>

      {/* ── CAMERA ── */}
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      </View>

      {/* ── MODE CARDS ── */}
      <View style={styles.modeRow}>
        {MODES.map(mode => (
          <TouchableOpacity
            key={mode}
            style={[
              styles.modeCard,
              currentMode === mode && styles.modeCardActive,
            ]}
            onPress={() => handleModeTap(mode)}
            accessibilityLabel={`${MODE_LABELS[mode]} mode`}
            accessibilityHint={`Double tap to switch to ${MODE_LABELS[mode]} mode`}
            accessibilityRole="button"
          >
            <Text style={styles.modeCardIcon}>{MODE_ICONS[mode]}</Text>
            <Text style={[
              styles.modeCardLabel,
              currentMode === mode && styles.modeCardLabelActive,
            ]}>
              {MODE_LABELS[mode]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── RESPONSE BOX ── */}
      <View style={styles.responseBox}>
        <ScrollView contentContainerStyle={styles.responseScrollContent}>
          <Text style={styles.responseText}>
            {lastResponse || 'Say "scan" to analyze your surroundings.'}
          </Text>
        </ScrollView>
        {lastHeard ? (
          <Text style={styles.lastHeardText}>Heard: "{lastHeard}"</Text>
        ) : null}
        {memoryContext ? (
          <Text style={styles.memoryBadgeText}>🧠 {memoryContext.slice(0, 60)}...</Text>
        ) : null}
      </View>

      {/* ── NAVIGATION BANNER ── */}
      {navigationInfo && (
        <View style={styles.navBanner}>
          <Text style={styles.navText}>
            {navigationInfo.instruction} ({Math.round(navigationInfo.distance)}m)
          </Text>
        </View>
      )}

      {/* ── COMMUNITY HAZARD BANNER ── */}
      {communityHazards.length > 0 && (
        <View style={styles.hazardBanner}>
          <Text style={styles.hazardText}>
            ⚠️ {communityHazards[0].description} reported nearby
          </Text>
        </View>
      )}

      {/* ── MIC BUTTON ── */}
      <TouchableOpacity
        style={[
          styles.micButton,
          isListening && styles.micButtonActive,
          isScanning && styles.micButtonDisabled,
        ]}
        onPress={handleMicTap}
        disabled={isScanning}
        accessibilityLabel="Tap to talk. Say a command like scan, navigate, read, identify, or help."
        accessibilityRole="button"
      >
        <Text style={styles.micButtonIcon}>🎤</Text>
        <Text style={styles.micButtonText}>
          {isListening ? 'Listening...' : isScanning ? 'Scanning...' : 'TAP TO TALK'}
        </Text>
      </TouchableOpacity>

      {/* ── PANIC BUTTON ── */}
      <TouchableOpacity
        style={styles.panicButton}
        onPress={handlePanic}
        accessibilityLabel="I am lost. Tap to get help immediately."
        accessibilityRole="button"
      >
        <Text style={styles.panicText}>🆘  I'M LOST</Text>
      </TouchableOpacity>

      {/* ── HAZARD REPORT ROW ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.hazardReportRow}
      >
        {HAZARD_TYPES.map(type => (
          <TouchableOpacity
            key={type}
            style={styles.hazardReportButton}
            onPress={() => handleReportHazard(type)}
            accessibilityLabel={`Report hazard: ${type}`}
            accessibilityRole="button"
          >
            <Text style={styles.hazardReportText}>⚠️ {type}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── DESTINATION SELECTOR ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.destinationRow}>
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
            accessibilityLabel={`Navigate to ${loc.name}`}
            accessibilityRole="button"
          >
            <Text style={styles.destText}>{loc.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

    </SafeAreaView>
  );
}

// ─── STYLES ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a12' },

  // Permission screens
  permissionText: { color: '#fff', fontSize: 20, textAlign: 'center', marginTop: 60, paddingHorizontal: 20 },
  permissionButton: { backgroundColor: '#2563eb', margin: 20, padding: 18, borderRadius: 14, alignItems: 'center' },
  permissionButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },

  // Status bar
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#111118',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  micIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#333',
  },
  micIndicatorActive: {
    backgroundColor: '#1a1500',
    borderColor: '#f59e0b',
  },
  micIcon: { fontSize: 16, marginRight: 6 },
  micLabel: { color: '#aaa', fontSize: 13 },
  modeBadge: {
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  modeBadgeText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },

  // Camera
  cameraContainer: { width: '100%', height: 220 },
  camera: { flex: 1 },

  // Mode cards
  modeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: '#111118',
  },
  modeCard: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a28',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#2a2a3a',
    width: 100,
    height: 80,
  },
  modeCardActive: {
    backgroundColor: '#1e3a5f',
    borderColor: '#3b82f6',
  },
  modeCardIcon: { fontSize: 28, marginBottom: 4 },
  modeCardLabel: { color: '#888', fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
  modeCardLabelActive: { color: '#fff' },

  // Response box — LARGE readable text
  responseBox: {
    flex: 1,
    backgroundColor: '#111118',
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#222',
    padding: 16,
  },
  responseScrollContent: { flexGrow: 1 },
  responseText: {
    color: '#fff',
    fontSize: 24,
    lineHeight: 34,
    fontWeight: '300',
  },
  lastHeardText: {
    color: '#f59e0b',
    fontSize: 13,
    marginTop: 8,
    fontStyle: 'italic',
  },
  memoryBadgeText: {
    color: '#10b981',
    fontSize: 12,
    marginTop: 8,
  },

  // Nav banner
  navBanner: { backgroundColor: '#1d4ed8', marginHorizontal: 12, marginTop: 8, padding: 10, borderRadius: 10 },
  navText: { color: '#fff', fontSize: 15, textAlign: 'center', fontWeight: '500' },

  // Hazard banner
  hazardBanner: { backgroundColor: '#dc2626', marginHorizontal: 12, marginTop: 6, padding: 8, borderRadius: 10 },
  hazardText: { color: '#fff', fontSize: 14, textAlign: 'center', fontWeight: '500' },

  // Mic button — prominent and accessible
  micButton: {
    backgroundColor: '#1a1a2a',
    marginHorizontal: 12,
    marginTop: 10,
    paddingVertical: 22,
    borderRadius: 18,
    borderWidth: 2.5,
    borderColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  micButtonActive: {
    backgroundColor: '#1a1500',
    borderColor: '#f59e0b',
  },
  micButtonDisabled: {
    backgroundColor: '#1a1a2a',
    borderColor: '#444',
  },
  micButtonIcon: { fontSize: 28, marginRight: 10 },
  micButtonText: { color: '#fff', fontSize: 22, fontWeight: 'bold', letterSpacing: 1 },

  // Panic button
  panicButton: {
    backgroundColor: '#dc2626',
    marginHorizontal: 12,
    marginTop: 10,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  panicText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },

  // Hazard report row
  hazardReportRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxHeight: 44,
  },
  hazardReportButton: {
    backgroundColor: '#2a1a00',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#92400e',
  },
  hazardReportText: { color: '#fbbf24', fontSize: 12, fontWeight: '500' },

  // Destination row
  destinationRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxHeight: 50,
  },
  destButton: {
    backgroundColor: '#1a1a2a',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  destButtonActive: { backgroundColor: '#065f46', borderColor: '#10b981' },
  destText: { color: '#ccc', fontSize: 12, fontWeight: '500' },
});

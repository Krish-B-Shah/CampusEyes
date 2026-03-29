import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { analyzeScene } from '../services/detectionService';
import { startObstacleMonitor, stopObstacleMonitor, clearObstacleMemory, setObstacleContextRefs } from '../services/obstacleService';
import { speak, stopSpeaking } from '../services/speechService';
import { listenOnce } from '../services/voiceService';
import { calculateNavigation, fetchRouteWithFallback, speakNavigationStep, speakUpcomingStep, getLocationById, getDistanceFromRoute } from '../services/navigationService';
import { saveLocationMemory, getLocationMemory, formatMemoryContext } from '../services/memoryService';
import { getNearbyHazards, subscribeToHazards } from '../services/hazardService';
import { LOCATIONS } from '../constants/locations';

const MAX_HISTORY_ENTRIES = 10;

// ─── Map HTML — uses real route geometry from OSRM ──────────────────────────
const MAP_HTML = (userLat, userLng, routeCoords, dest, hazards, isFallbackRoute) => {
  // routeCoords is [[lon, lat], ...] from OSRM
  const hasRoute = routeCoords && routeCoords.length >= 2;
  const routeJs = hasRoute
    ? `JSON.parse('${JSON.stringify(routeCoords)}')`
    : 'null';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; background: #111118; }
    #map { width: 100%; height: 100%; }
    .leaflet-control-attribution { display: none; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      touchZoom: false,
    }).setView([${userLat}, ${userLng}], 17);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      detectRetina: true,
    }).addTo(map);

    const userIcon = L.divIcon({
      className: '', iconSize: [20, 20], iconAnchor: [10, 10],
      html: '<div style="width:20px;height:20px;background:#3b82f6;border-radius:50%;border:3px solid #93c5fd;box-shadow:0 0 12px #3b82f6;position:relative;"><div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:6px;height:6px;background:#fff;border-radius:50%;"></div></div>'
    });
    const userMarker = L.marker([${userLat}, ${userLng}], { icon: userIcon }).addTo(map);

    ${dest ? `
    const destIcon = L.divIcon({
      className: '', iconSize: [18, 18], iconAnchor: [9, 9],
      html: '<div style="width:18px;height:18px;background:#10b981;border-radius:50%;border:2px solid #6ee7b7;box-shadow:0 0 8px #10b981;"></div>'
    });
    L.marker([${dest.latitude}, ${dest.longitude}], { icon: destIcon }).addTo(map).bindPopup('${dest.name.replace(/'/g, "\\'")}');
    ` : ''}

    var fallbackLine;
    ${hasRoute ? `
    const routeCoords = ${routeJs};
    const latlngs = routeCoords.map(c => [c[1], c[0]]);
    const routeLine = L.polyline(latlngs, {
      color: '#3b82f6',
      weight: 6,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [50, 50], maxZoom: 18 });
    ` : ''}
    ${!hasRoute && dest ? `
    fallbackLine = L.polyline([
      [${userLat}, ${userLng}],
      [${dest.latitude}, ${dest.longitude}]
    ], {
      color: '#f59e0b',
      weight: 5,
      opacity: 0.7,
      dashArray: '12, 10',
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);
    map.fitBounds(fallbackLine.getBounds(), { padding: [50, 50], maxZoom: 18 });
    ` : ''}

    ${hazards.map(h => `
    const hIcon = L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: '<div style="width:14px;height:14px;background:#dc2626;border-radius:50%;border:2px solid #fca5a5;"></div>' });
    L.marker([${h.latitude}, ${h.longitude}], { icon: hIcon }).addTo(map).bindPopup('${h.description.replace(/'/g, "\\'")}');
    `).join('')}
  </script>
</body>
</html>
  `;
};

// Update user position on map
const MAP_UPDATE_JS = (lat, lng, routeCoords, dest, isFallbackRoute) => `
  if (typeof userMarker !== 'undefined') {
    userMarker.setLatLng([${lat}, ${lng}]);
  }
  if (typeof routeLine !== 'undefined' && routeCoords && routeCoords.length >= 2) {
    var latlngs = routeCoords.map(function(c) { return [c[1], c[0]]; });
    routeLine.setLatLngs(latlngs);
  }
  if (typeof fallbackLine !== 'undefined' && ${isFallbackRoute}) {
    var latlngs = fallbackLine.getLatLngs();
    if (latlngs.length >= 2) {
      latlngs[0] = [${lat}, ${lng}];
      fallbackLine.setLatLngs(latlngs);
    }
  }
`;

export default function MobileModeScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [currentLocation, setCurrentLocation] = useState(null);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [currentMode, setCurrentMode] = useState('navigate');
  const [isScanning, setIsScanning] = useState(false);
  const [lastResponse, setLastResponse] = useState('Tap the microphone and speak a command.');
  const [conversationHistory, setConversationHistory] = useState([]);
  const [memoryContext, setMemoryContext] = useState(null);
  const [communityHazards, setCommunityHazards] = useState([]);
  const [navigationInfo, setNavigationInfo] = useState(null);
  const [routeData, _setRouteData] = useState(null); // OSRM route with geometry
  const routeDataRef = useRef(null);
  const setRouteData = (data) => {
    routeDataRef.current = data;
    _setRouteData(data);
  };
  const [isListening, setIsListening] = useState(false);
  const [lastHeard, setLastHeard] = useState('');
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [modeText, setModeText] = useState('');
  const [cameraReady, setCameraReady] = useState(false);

  const cameraRef = useRef(null);
  const webViewRef = useRef(null);
  const navIntervalRef = useRef(null);
  const hazardUnsubRef = useRef(null);
  const firstLocationRef = useRef(false);

  const currentModeRef = useRef(currentMode);
  const lastResponseRef = useRef(lastResponse);
  const selectedDestRef = useRef(selectedDestination);
  const currentLocationRef = useRef(null);
  const routeDataIntervalRef = useRef(null);
  const lastRerouteTimeRef = useRef(null);

  useEffect(() => { currentModeRef.current = currentMode; }, [currentMode]);
  useEffect(() => { lastResponseRef.current = lastResponse; }, [lastResponse]);
  useEffect(() => { selectedDestRef.current = selectedDestination; }, [selectedDestination]);
  useEffect(() => { currentLocationRef.current = currentLocation; }, [currentLocation]);

  // Keep obstacle context refs in sync as state changes
  useEffect(() => {
    setObstacleContextRefs({
      getMemoryContext: () => memoryContext,
      getCommunityHazards: () => communityHazards,
      getDestination: () => selectedDestRef.current ? getLocationById(selectedDestRef.current)?.name : null,
    });
  }, [memoryContext, communityHazards, selectedDestination]);

  // ─── PERMISSIONS ──────────────────────────────────────────────────────────
  useEffect(() => {
    requestCameraPermission();
    requestLocationPermission();
    return () => {
      if (navIntervalRef.current) clearInterval(navIntervalRef.current);
      if (hazardUnsubRef.current) hazardUnsubRef.current();
      stopObstacleMonitor();
    };
  }, []);

  const requestLocationPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') startLocationTracking();
  };

  // ─── FETCH ROUTE ──────────────────────────────────────────────────────────
  const loadRoute = useCallback(async (destId) => {
    const dest = getLocationById(destId);
    const loc = currentLocation;
    if (!dest || !loc) return;

    const route = await fetchRouteWithFallback(
      loc.latitude, loc.longitude,
      dest.latitude, dest.longitude
    );
    setRouteData(route);
    setMapKey(k => k + 1);

    if (route.provider === 'straight') {
      speak('Route service unavailable. Showing direct path to destination.', true);
    }
  }, [currentLocation]);

  const startLocationTracking = async () => {
    await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 3 },
      async (loc) => {
        const coords = loc.coords;
        setCurrentLocation(coords);

        if (webViewRef.current) {
          const dest = selectedDestRef.current ? getLocationById(selectedDestRef.current) : null;
          const rc = routeDataRef.current?.geometry;
          const isFallback = routeDataRef.current?.provider === 'straight';
          webViewRef.current.injectJavaScript(MAP_UPDATE_JS(coords.latitude, coords.longitude, rc, dest, isFallback));
        }

        if (!firstLocationRef.current) {
          firstLocationRef.current = true;
          const memory = await getLocationMemory(coords.latitude, coords.longitude);
          setMemoryContext(formatMemoryContext(memory));
          const hazards = await getNearbyHazards(coords.latitude, coords.longitude);
          setCommunityHazards(hazards);
          hazardUnsubRef.current = subscribeToHazards(
            coords.latitude, coords.longitude,
            (newHazard) => {
              setCommunityHazards(prev =>
                prev.some(h => h.id === newHazard.id) ? prev : [...prev, newHazard]
              );
              speak(`Warning — ${newHazard.description} reported nearby.`, true);
            }
          );

          // Wire up live context so obstacle scans always use current state
          setObstacleContextRefs({
            getMemoryContext: () => memoryContext,
            getCommunityHazards: () => communityHazards,
            getDestination: () => selectedDestRef.current ? getLocationById(selectedDestRef.current)?.name : null,
          });

          // Start obstacle monitoring after first location
          startObstacleMonitor(cameraRef, {
            onObstacles: (obstacles, announcement) => {
              if (announcement) speak(announcement, true);
            },
          });
        }
      }
    );
  };

  // ─── MODE CHANGE ──────────────────────────────────────────────────────────
  useEffect(() => {
    const labels = { navigate: 'Navigate', read: 'Read Text', identify: 'Identify Objects' };
    setModeText(labels[currentMode] || currentMode);
    speak(`Now in ${currentMode} mode. Say scan to analyze.`);
  }, [currentMode]);

  // ─── NAVIGATION: fetch route when destination changes ─────────────────────
  useEffect(() => {
    if (navIntervalRef.current) clearInterval(navIntervalRef.current);

    if (currentLocation && selectedDestination) {
      loadRoute(selectedDestination);

      navIntervalRef.current = setInterval(async () => {
        const dest = getLocationById(selectedDestination);
        const loc = currentLocationRef.current;
        if (!dest || !loc) return;

        const route = routeDataRef.current;

        // Off-route detection
        if (route && route.provider !== 'straight') {
          const offRouteDist = getDistanceFromRoute(loc, route);
          const now = Date.now();
          if (offRouteDist > NAVIGATION_CONFIG.offRouteThreshold) {
            if (!lastRerouteTimeRef.current || (now - lastRerouteTimeRef.current > NAVIGATION_CONFIG.rerouteCooldownMs)) {
              lastRerouteTimeRef.current = now;
              speak('You seem to have gone off the planned route. Recalculating.', true);
              loadRoute(selectedDestination);
              return;
            }
          }
        }

        // Voice guidance — always runs
        if (route?.steps?.length) {
          const info = speakNavigationStep(route, loc.latitude, loc.longitude);
          if (info) setNavigationInfo(info);

          // Look-ahead turn announcement
          const upcoming = speakUpcomingStep(route, loc.latitude, loc.longitude);
          if (upcoming) speak(upcoming);
        } else {
          // Fallback: bearing-based guidance
          const nav = calculateNavigation(loc, dest);
          if (nav) {
            setNavigationInfo({
              instruction: nav.instruction,
              distanceMeters: nav.distanceMeters,
              hasArrived: nav.hasArrived,
            });
          }
        }
      }, 3000);
    } else {
      setRouteData(null);
      setNavigationInfo(null);
    }

    return () => clearInterval(navIntervalRef.current);
  }, [selectedDestination, loadRoute]);

  // ─── DESTINATION PICKED ─────────────────────────────────────────────────
  const pickDestination = useCallback((destId) => {
    setSelectedDestination(destId);
    const dest = getLocationById(destId);
    if (dest) speak(`Navigating to ${dest.name}.`);
  }, []);

  // ─── VOICE COMMAND ───────────────────────────────────────────────────────
  const matchDestination = (heard) => {
    const words = heard.split(/\s+/);
    return LOCATIONS.find(loc =>
      words.some(w => loc.name.toLowerCase().includes(w) || loc.id.includes(w))
    ) || null;
  };

  const handleVoiceCommand = useCallback(({ command, args }) => {
    const response = lastResponseRef.current;
    const heard = (args[0] || '').toLowerCase();

    switch (command) {
      case 'navigate':    setCurrentMode('navigate'); speak('Navigate mode.'); break;
      case 'read':         setCurrentMode('read'); speak('Read mode.'); break;
      case 'identify':     setCurrentMode('identify'); speak('Identify mode.'); break;
      case 'scan':         triggerScan(); break;
      case 'repeat':       response ? speak(response, true) : speak('Say scan first.'); break;
      case 'help':
        speak('Say scan to analyze. Say navigate, read, or identify to change mode. Say a building name to navigate there. Say panic if lost.', true);
        break;
      case 'panic':        triggerPanic(); break;
      case 'stop':         stopSpeaking(); break;
      case null: {
        const loc = matchDestination(heard);
        if (loc) {
          pickDestination(loc.id);
        } else {
          speak(`Didn't catch that. Say scan or help.`);
        }
        break;
      }
      default:
        speak('Microphone error. Try again.');
    }
  }, [pickDestination]);

  // ─── SCAN ────────────────────────────────────────────────────────────────
  const triggerScan = useCallback(() => {
    if (!cameraRef.current || isScanning) return;
    performScan();
  }, [isScanning]);

  const performScan = async () => {
    if (!cameraRef.current || isScanning) return;
    setIsScanning(true);
    stopSpeaking();
    speak('Scanning...');

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: false });
      const destName = selectedDestination ? getLocationById(selectedDestination)?.name : null;

      const response = await analyzeScene({
        imageUri: photo.uri,
        mode: currentModeRef.current,
        conversationHistory,
        memoryContext,
        communityHazards,
        destination: destName,
      });

      setLastResponse(response);
      setLastHeard('');
      speak(response, true);

      setConversationHistory(prev => {
        const next = [
          ...prev,
          { role: 'user', parts: [{ text: `[${currentModeRef.current} scan]` }] },
          { role: 'model', parts: [{ text: response }] },
        ];
        return next.slice(-MAX_HISTORY_ENTRIES);
      });

      const loc = currentLocation;
      if (loc) {
        await saveLocationMemory(loc.latitude, loc.longitude, response);
        const memory = await getLocationMemory(loc.latitude, loc.longitude);
        setMemoryContext(formatMemoryContext(memory));
        const hazards = await getNearbyHazards(loc.latitude, loc.longitude);
        setCommunityHazards(hazards);
      }
    } catch (err) {
      console.error('Scan error:', err);
      const msg = 'Scan failed. Try again.';
      setLastResponse(msg);
      speak(msg);
    } finally {
      setIsScanning(false);
    }
  };

  // ─── PANIC ───────────────────────────────────────────────────────────────
  const performPanic = async () => {
    if (!cameraRef.current) return;
    stopSpeaking();
    speak('Locating you now. Please hold still.', true);
    setIsScanning(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      const destName = selectedDestination ? getLocationById(selectedDestination)?.name : null;

      const response = await analyzeScene({
        imageUri: photo.uri,
        mode: 'panic',
        conversationHistory: [],
        memoryContext,
        communityHazards,
        destination: destName,
      });

      setLastResponse(response);
      speak(response, true);
      setConversationHistory([]);
    } catch {
      speak('Could not locate you. Try again.');
    } finally {
      setIsScanning(false);
    }
  };

  const triggerPanic = useCallback(() => {
    performPanic();
  }, [communityHazards, memoryContext, selectedDestination]);

  // ─── MIC ─────────────────────────────────────────────────────────────────
  const handleMicTap = async () => {
    if (isListening || isScanning) return;
    setLastHeard('');
    await listenOnce(
      (cmd) => {
        if (cmd.args?.[0]) setLastHeard(cmd.args[0]);
        handleVoiceCommand(cmd);
      },
      (listening) => setIsListening(listening)
    );
  };

  const handlePanicButton = () => performPanic();

  // ─── CAMERA REF CALLBACK ─────────────────────────────────────────────────
  const handleCameraRef = (ref) => {
    cameraRef.current = ref;
    if (ref) setCameraReady(true);
  };

  // ─── PERMISSION STATES ────────────────────────────────────────────────────
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

  // ─── RENDER ──────────────────────────────────────────────────────────────
  const dest = selectedDestination ? getLocationById(selectedDestination) : null;
  const mapLat = currentLocation?.latitude ?? 28.0605;
  const mapLng = currentLocation?.longitude ?? -82.4135;
  const routeCoords = routeData?.geometry ?? null;
  const isFallback = routeData?.provider === 'straight';
  const mapHtml = MAP_HTML(mapLat, mapLng, routeCoords, dest, communityHazards, isFallback);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* ─── TOP: CAMERA ─────────────────────────────────────────────────── */}
      <View style={styles.cameraContainer}>
        <CameraView
          ref={handleCameraRef}
          style={styles.camera}
          facing="back"
        />

        {/* Overlay badges */}
        <View style={styles.cameraOverlay}>
          <View style={styles.modeBadge}>
            <Text style={styles.modeBadgeText}>{modeText.toUpperCase()}</Text>
          </View>

          {dest && (
            <View style={styles.destPill}>
              <Text style={styles.destPillText}>→ {dest.name.split('(')[0].trim()}</Text>
            </View>
          )}
        </View>

        {isScanning && (
          <View style={styles.scanningBadge}>
            <Text style={styles.scanningText}>🔍 SCANNING</Text>
          </View>
        )}
      </View>

      {/* ─── MIDDLE: MAP ─────────────────────────────────────────────────── */}
      <View style={styles.mapContainer}>
        <WebView
          key={mapKey}
          ref={webViewRef}
          source={{ html: mapHtml }}
          style={styles.webview}
          scrollEnabled={false}
          zoomEnabled={false}
          javaScriptEnabled={true}
          originWhitelist={['*']}
          onMessage={() => {}}
        />

        {/* Nav instruction */}
        {navigationInfo && (
          <View style={[styles.navOverlay, isFallback && styles.navOverlayFallback]}>
            {isFallback && (
              <Text style={styles.navOverlayFallbackBadge}>DIRECT</Text>
            )}
            <Text style={styles.navOverlayText} numberOfLines={2}>
              {navigationInfo.instruction}
            </Text>
            <Text style={styles.navOverlayDist}>
              {Math.round(navigationInfo.distanceMeters || 0)}m
            </Text>
          </View>
        )}

        {/* Map controls */}
        <TouchableOpacity
          style={styles.mapDestButton}
          onPress={() => setShowDestPicker(p => !p)}
        >
          <Text style={styles.mapDestButtonText}>
            {dest ? '✕' : '🗺️'}
          </Text>
        </TouchableOpacity>

        {communityHazards.length > 0 && (
          <View style={styles.hazardPill}>
            <Text style={styles.hazardPillText}>⚠️ {communityHazards.length} nearby</Text>
          </View>
        )}
      </View>

      {/* ─── BOTTOM ──────────────────────────────────────────────────────── */}
      <View style={styles.bottomSection}>

        {/* Response */}
        <View style={styles.responseBox}>
          <Text style={styles.responseText} numberOfLines={2}>
            {lastResponse}
          </Text>
          {lastHeard ? (
            <Text style={styles.lastHeardText}>Heard: "{lastHeard}"</Text>
          ) : null}
        </View>

        {/* Mode buttons */}
        <View style={styles.modeRow}>
          {['navigate', 'read', 'identify'].map(mode => (
            <TouchableOpacity
              key={mode}
              style={[styles.modeButton, currentMode === mode && styles.modeButtonActive]}
              onPress={() => setCurrentMode(mode)}
              disabled={isScanning}
            >
              <Text style={[styles.modeButtonText, currentMode === mode && styles.modeButtonTextActive]}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Mic + Panic */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[
              styles.micButton,
              isListening && styles.micButtonListening,
              isScanning && styles.micButtonDisabled,
            ]}
            onPress={handleMicTap}
            disabled={isScanning}
            activeOpacity={0.7}
          >
            <View style={[styles.micRing, isListening && styles.micRingActive]} />
            <Text style={styles.micButtonIcon}>🎤</Text>
            <Text style={styles.micButtonLabel}>
              {isListening ? 'LISTENING...' : isScanning ? 'SCANNING...' : 'TAP TO TALK'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.panicButton}
            onPress={handlePanicButton}
            activeOpacity={0.7}
          >
            <Text style={styles.panicIcon}>🆘</Text>
            <Text style={styles.panicLabel}>I'M LOST</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ─── DESTINATION PICKER ──────────────────────────────────────────── */}
      <Modal
        visible={showDestPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDestPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose Destination</Text>
              <TouchableOpacity onPress={() => setShowDestPicker(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.modalList}>
              <TouchableOpacity
                style={[styles.destItem, !selectedDestination && styles.destItemActive]}
                onPress={() => {
                  setSelectedDestination(null);
                  setRouteData(null);
                  setNavigationInfo(null);
                  setMapKey(k => k + 1);
                  setShowDestPicker(false);
                  speak('Destination cleared.');
                }}
              >
                <Text style={styles.destItemText}>— None —</Text>
              </TouchableOpacity>
              {LOCATIONS.map(loc => (
                <TouchableOpacity
                  key={loc.id}
                  style={[styles.destItem, selectedDestination === loc.id && styles.destItemActive]}
                  onPress={() => {
                    pickDestination(loc.id);
                    setMapKey(k => k + 1);
                    setShowDestPicker(false);
                  }}
                >
                  <Text style={styles.destItemText}>{loc.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

// ─── STYLES ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a12' },

  permissionText: { color: '#fff', fontSize: 20, textAlign: 'center', marginTop: 80, paddingHorizontal: 24 },
  permissionButton: { backgroundColor: '#2563eb', margin: 24, padding: 18, borderRadius: 14, alignItems: 'center' },
  permissionButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },

  // Camera
  cameraContainer: { width: '100%', height: '42%', position: 'relative', overflow: 'hidden', backgroundColor: '#000' },
  camera: { width: '100%', height: '100%' },
  cameraOverlay: {
    position: 'absolute', top: 12, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  modeBadge: { backgroundColor: 'rgba(29, 78, 216, 0.85)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  modeBadgeText: { color: '#fff', fontSize: 13, fontWeight: 'bold', letterSpacing: 1 },
  destPill: { backgroundColor: 'rgba(16, 185, 129, 0.85)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, maxWidth: '55%' },
  destPillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  scanningBadge: { position: 'absolute', bottom: 12, alignSelf: 'center', backgroundColor: 'rgba(245, 158, 11, 0.9)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  scanningText: { color: '#000', fontSize: 14, fontWeight: 'bold' },

  // Map
  mapContainer: { width: '100%', height: '30%', backgroundColor: '#111118', position: 'relative', overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: '#111118' },
  navOverlay: {
    position: 'absolute', bottom: 10, left: 10, right: 60,
    backgroundColor: 'rgba(29, 78, 216, 0.92)', borderRadius: 14,
    padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  navOverlayFallback: { backgroundColor: 'rgba(180, 120, 0, 0.92)' },
  navOverlayFallbackBadge: { color: '#fde68a', fontSize: 10, fontWeight: 'bold', marginBottom: 4 },
  navOverlayText: { color: '#fff', fontSize: 14, fontWeight: '500', flex: 1, marginRight: 10 },
  navOverlayDist: { color: '#bfdbfe', fontSize: 20, fontWeight: 'bold' },
  mapDestButton: {
    position: 'absolute', top: 10, right: 10,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(26, 26, 42, 0.9)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#333',
  },
  mapDestButtonText: { fontSize: 18 },
  hazardPill: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(220, 38, 38, 0.85)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  hazardPillText: { color: '#fff', fontSize: 11, fontWeight: '600' },

  // Bottom
  bottomSection: { flex: 1, backgroundColor: '#0a0a12', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 },

  responseBox: {
    backgroundColor: '#111118', borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#1a1a2a', minHeight: 70, justifyContent: 'center',
  },
  responseText: { color: '#e5e5e5', fontSize: 17, lineHeight: 24, fontWeight: '300' },
  lastHeardText: { color: '#f59e0b', fontSize: 12, fontStyle: 'italic', marginTop: 4 },

  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  modeButton: {
    flex: 1, backgroundColor: '#111118', paddingVertical: 10, borderRadius: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#1a1a2a',
  },
  modeButtonActive: { backgroundColor: '#1e3a5f', borderColor: '#3b82f6' },
  modeButtonText: { color: '#666', fontSize: 12, fontWeight: '600' },
  modeButtonTextActive: { color: '#fff' },

  actionRow: { flexDirection: 'row', gap: 10 },

  micButton: {
    flex: 1, backgroundColor: '#111118', borderRadius: 20, borderWidth: 2.5, borderColor: '#3b82f6',
    alignItems: 'center', justifyContent: 'center', paddingVertical: 18, position: 'relative', overflow: 'hidden',
  },
  micButtonListening: { borderColor: '#f59e0b', backgroundColor: '#1a1500' },
  micButtonDisabled: { borderColor: '#333' },
  micRing: { position: 'absolute', width: '100%', height: '100%', borderRadius: 20, borderWidth: 2, borderColor: 'transparent' },
  micRingActive: { borderColor: '#f59e0b' },
  micButtonIcon: { fontSize: 28, marginBottom: 4 },
  micButtonLabel: { color: '#fff', fontSize: 14, fontWeight: 'bold', letterSpacing: 0.5 },

  panicButton: {
    width: 80, backgroundColor: '#dc2626', borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 14,
  },
  panicIcon: { fontSize: 26, marginBottom: 2 },
  panicLabel: { color: '#fff', fontSize: 10, fontWeight: 'bold' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a2a', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: '#2a2a3a',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  modalClose: { color: '#666', fontSize: 20, padding: 4 },
  modalList: { padding: 12, paddingBottom: 40 },
  destItem: {
    backgroundColor: '#111118', paddingVertical: 16, paddingHorizontal: 20,
    borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: '#2a2a3a',
  },
  destItemActive: { backgroundColor: '#1e3a5f', borderColor: '#3b82f6' },
  destItemText: { color: '#ccc', fontSize: 16 },
});

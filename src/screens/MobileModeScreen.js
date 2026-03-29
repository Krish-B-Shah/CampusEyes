import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, Modal, Animated
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { analyzeScene, askAboutFrame, readVisibleText, chatWithLily } from '../services/detectionService';
import { startObstacleMonitor, stopObstacleMonitor, clearObstacleMemory, setObstacleContextRefs } from '../services/obstacleService';
import { speak, stopSpeaking, initVoice } from '../services/speechService';
import { listenOnce } from '../services/voiceService';
import { calculateNavigation, fetchRouteWithFallback, speakNavigationStep, speakUpcomingStep, getLocationById, getDistanceFromRoute, resetNavigationState, formatDistanceText } from '../services/navigationService';
import { saveLocationMemory, getLocationMemory, formatMemoryContext } from '../services/memoryService';
import { getNearbyHazards, subscribeToHazards } from '../services/hazardService';
import { LOCATIONS, NAVIGATION_CONFIG } from '../constants/locations';
import * as Haptics from 'expo-haptics';

const MAX_HISTORY_ENTRIES = 10;

// ─── Map HTML — uses real route geometry from OSRM ──────────────────────────
const MAP_HTML = (userLat, userLng, routeCoords, dest, hazards, isFallbackRoute, userHeading = 0) => {
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
      zoomControl: true,
      attributionControl: false,
      doubleClickZoom: true,
      scrollWheelZoom: true,
      touchZoom: true,
    }).setView([${userLat}, ${userLng}], 17);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      detectRetina: true,
    }).addTo(map);

    const userIcon = L.divIcon({
      className: '', iconSize: [28, 28], iconAnchor: [14, 14],
      html: '<div id="user-heading-cone" style="width:100%;height:100%;position:relative;transform:rotate(' + (${userHeading || 0}) + 'deg);transition:transform 0.3s ease-out;"><div style="width:20px;height:20px;background:#3b82f6;border-radius:50%;border:3px solid #fff;box-shadow:0 0 8px rgba(0,0,0,0.4);position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);"></div><div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:16px solid rgba(59,130,246,0.8);position:absolute;top:-6px;left:50%;transform:translateX(-50%);"></div></div>'
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

export default function MobileModeScreen({ initialUserData }) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [currentLocation, setCurrentLocation] = useState(null);
  const headingAnim = useRef(new Animated.Value(0)).current;
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [lastResponse, setLastResponse] = useState('Camera active. Obstacles are being monitored.');
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
  const [cameraReady, setCameraReady] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [profile, setProfile] = useState({
    name: initialUserData?.name || 'Student',
    homeBuildingId: null,
    walkingSpeed: 1.4,
    age: initialUserData?.age || null,
    campus: initialUserData?.campus || null,
  });

  const cameraRef = useRef(null);
  const webViewRef = useRef(null);
  const navIntervalRef = useRef(null);
  const hazardUnsubRef = useRef(null);
  const firstLocationRef = useRef(false);

  const lastResponseRef = useRef(lastResponse);
  const selectedDestRef = useRef(selectedDestination);
  const currentLocationRef = useRef(null);
  const currentHeadingRef = useRef(null);
  const routeDataIntervalRef = useRef(null);
  const lastRerouteTimeRef = useRef(null);

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
    resetNavigationState(); // reset voice trackers when new route is loaded
    setRouteData(route);
    setMapKey(k => k + 1);

    if (route.provider === 'straight') {
      speak('Route service unavailable. Showing direct path to destination.', true);
    }
  }, [currentLocation]);

  const startLocationTracking = async () => {
    // 1. Start continuous heading/compass updates
    await Location.watchHeadingAsync((headingObj) => {
      // Use trueHeading if available and valid, otherwise fallback to magHeading
      let heading = null;
      if (headingObj.trueHeading >= 0) {
        heading = headingObj.trueHeading;
      } else if (headingObj.magHeading >= 0) {
        heading = headingObj.magHeading;
      }
      if (heading !== null) {
        currentHeadingRef.current = heading;
        headingAnim.setValue(heading);
        if (webViewRef.current) {
          webViewRef.current.injectJavaScript("var cone = document.getElementById('user-heading-cone'); if (cone) { cone.style.transform = 'rotate(" + heading + "deg)'; } true;");
        }
      }
    }).catch(err => console.log('Compass not available:', err));

    // 2. Start continuous GPS position updates
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
        }
      }
    );
  };

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
          if (info) {
            setNavigationInfo(info);
            // Arrival detection
            if (info.hasArrived && info.isNewStep) {
              const bName = dest?.name?.split('(')[0]?.trim() || 'your destination';
              speak(`You have reached ${bName}.`, true);
              setSelectedDestination(null); // End navigation
            } else if (info.isNewStep && info.instruction) {
              speak(info.instruction, true);
            }
          }

          // Look-ahead turn announcement
          const upcoming = speakUpcomingStep(route, loc.latitude, loc.longitude);
          if (upcoming) speak(upcoming);
        } else {
          // Fallback: bearing-based guidance if no route steps are available
          const nav = calculateNavigation(loc, dest, currentHeadingRef.current);
          if (nav) {
            setNavigationInfo({
              instruction: nav.instruction,
              distanceMeters: nav.distanceMeters,
              hasArrived: nav.hasArrived,
            });

            if (nav.hasArrived) {
              const bName = dest?.name?.split('(')[0]?.trim() || 'your destination';
              speak(`You have reached ${bName}.`, true);
              setSelectedDestination(null); // End navigation
            }
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
    const text = heard.toLowerCase();
    const sortedLocs = [...LOCATIONS].sort((a,b) => b.name.length - a.name.length);
    for (const loc of sortedLocs) {
      const cleanName = loc.name.split('(')[0].trim().toLowerCase();
      if (text.includes(cleanName) || text.includes(loc.id.toLowerCase())) {
         return loc;
      }
    }
    if (text.includes('engineering') && !text.includes('chemical')) return LOCATIONS.find(l => l.id === 'enb');
    if (text.includes('library')) return LOCATIONS.find(l => l.id === 'library');
    if (text.includes('marshall') || text.includes('msc')) return LOCATIONS.find(l => l.id === 'msb');
    return null;
  };

  // ─── GENERAL CONVERSATION WITH LILY ─────────────────────────────────────────
  const handleLilyChat = useCallback(async (message) => {
    stopSpeaking();
    try {
      // Optionally capture current frame for visual context
      let imageUri = null;
      if (cameraRef.current) {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.3, skipProcessing: true, shutterSound: false }).catch(() => null);
        imageUri = photo?.uri || null;
      }
      const reply = await chatWithLily(message, imageUri);
      setLastResponse(reply);
      speak(reply, true);
    } catch {
      speak("I'm here! Try asking me something again.");
    }
  }, []);

  // ─── READ VISIBLE TEXT (OCR) ───────────────────────────────────────────────────
  const handleReadText = useCallback(async () => {
    if (!cameraRef.current) { speak('Camera not ready.'); return; }
    stopSpeaking();
    speak('Reading the text...');
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, skipProcessing: true, shutterSound: false });
      const result = await readVisibleText(photo.uri);
      setLastResponse(result);
      speak(result, true);
    } catch {
      speak('Could not read text. Try again.');
    }
  }, []);

  // ─── QUESTION ABOUT FRAME ─────────────────────────────────────────────────
  const handleQuestion = useCallback(async (question) => {
    if (!cameraRef.current || isScanning) {
      speak('Camera not ready. Try again.');
      return;
    }
    stopSpeaking();
    speak('Let me look at that for you...');
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.4, skipProcessing: true, shutterSound: false });
      const answer = await askAboutFrame(photo.uri, question);
      setLastResponse(answer);
      speak(answer, true);
    } catch {
      speak('Could not answer that. Try again.');
    }
  }, [isScanning]);

  const handleVoiceCommand = useCallback(({ command, args }) => {
    const response = lastResponseRef.current;
    const heard = (args[0] || '').toLowerCase();

    switch (command) {
      case 'scan':     triggerScan(); break;
      case 'read':     handleReadText(); break;
      case 'repeat':   response ? speak(response, true) : speak('I haven\'t scanned anything yet. Try saying scan first.'); break;
      case 'help':     speak('I\'m Lily, your guide! You can say: scan to look around, read the sign, where is the door, or just name a building to navigate there.', true); break;
      case 'panic':    triggerPanic(); break;
      case 'stop':     stopSpeaking(); break;
      case 'question': handleQuestion(heard); break;
      case 'navigate': {
        const loc = matchDestination(heard);
        if (loc) { pickDestination(loc.id); break; }
        // Didn't match a building — treat as chat
        handleLilyChat(heard);
        break;
      }
      case null:
      default: {
        // First check if it sounds like navigation
        const loc = matchDestination(heard);
        if (loc) {
          pickDestination(loc.id);
        } else {
          // Otherwise hand off to Lily for general conversation
          handleLilyChat(heard);
        }
        break;
      }
    }
  }, [pickDestination, handleQuestion, handleReadText, handleLilyChat]);

  // ─── SCAN ────────────────────────────────────────────────────────────────
  const triggerScan = useCallback(() => {
    if (!cameraRef.current || isScanning) return;
    performScan();
  }, [isScanning]);

  const performScan = async () => {
    if (!cameraRef.current || isScanning) return;
    setIsScanning(true);
    stopSpeaking();
    speak('Let me take a look around for you...');

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.3, base64: false, skipProcessing: true, shutterSound: false });
      const destName = selectedDestination ? getLocationById(selectedDestination)?.name : null;

      const response = await analyzeScene({
        imageUri: photo.uri,
        purpose: 'navigate',
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
          { role: 'user', parts: [{ text: '[scan]' }] },
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
      const msg = 'I had trouble scanning just now. Let\'s try that again.';
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
        purpose: 'panic',
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
    // Confirm mic is active with a light tap
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setLastHeard('');
    await listenOnce(
      (cmd) => {
        if (cmd.args?.[0]) setLastHeard(cmd.args[0]);
        handleVoiceCommand(cmd);
      },
      (listening) => setIsListening(listening)
    );
  };

  // ─── CAMERA REF CALLBACK ─────────────────────────────────────────────────
  const handleCameraRef = (ref) => {
    cameraRef.current = ref;
    if (ref) setCameraReady(true);
  };

  // Start obstacle monitor as soon as camera is ready (no waiting for GPS)
  useEffect(() => {
    if (!cameraReady) return;
    setObstacleContextRefs({
      getMemoryContext: () => memoryContext,
      getCommunityHazards: () => communityHazards,
      getDestination: () => selectedDestRef.current ? getLocationById(selectedDestRef.current)?.name : null,
    });
    // Init Lily's female voice then greet
    initVoice().then(() => {
      const greeting = profile.name === 'Student' 
        ? "Hi there! I'm Lily, your guide. I'm already watching out for you. Tap the mic to ask me anything."
        : `Hi ${profile.name}! I'm Lily, your guide. I'm watching out for you. Ready to go?`;
      speak(greeting, true);
    });
    startObstacleMonitor(cameraRef, {
      onObstacles: (obstacles, announcement) => {
        if (announcement) speak(announcement, true);
      },
      onHaptic: (isHighDanger) => {
        if (isHighDanger) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }
      },
    });
  }, [cameraReady]);

  // ─── RENDER ──────────────────────────────────────────────────────────────
  const dest = selectedDestination ? getLocationById(selectedDestination) : null;
  const mapLat = currentLocation?.latitude ?? 28.0605;
  const mapLng = currentLocation?.longitude ?? -82.4135;
  const routeCoords = routeData?.geometry ?? null;
  const isFallback = routeData?.provider === 'straight';

  // Memoize the WebView to prevent flickering
  const memoizedWebView = useMemo(() => {
    const initialHtml = MAP_HTML(mapLat, mapLng, routeCoords, dest, communityHazards, isFallback, currentHeadingRef.current);
    return (
      <WebView
        ref={webViewRef}
        source={{ html: initialHtml, baseUrl: 'https://campuseyes.local/' }}
        style={styles.webview}
        scrollEnabled={true}
        zoomEnabled={true}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        onMessage={() => {}}
        allowsInlineMediaPlayback={false}
        mediaPlaybackRequiresUserAction={true}
        onError={() => console.warn('WebView error')}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#111118', justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: '#666', fontSize: 14 }}>Loading map...</Text>
          </View>
        )}
      />
    );
  }, [mapKey]); // Only re-render when mapKey (route/destination) changes

  const rotation = headingAnim.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '-360deg'],
  });

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
          {dest ? (
            <View style={styles.destPill}>
              <Text style={styles.destPillText}>→ {dest.name.split('(')[0].trim()}</Text>
            </View>
          ) : <View />}

          <TouchableOpacity 
            style={styles.profileButton}
            onPress={() => setShowProfile(true)}
          >
            <Text style={styles.profileButtonText}>
              {profile.age && parseInt(profile.age) < 30 ? '🎓' : 
               profile.age && parseInt(profile.age) >= 30 ? '🧑‍🏫' : '👤'}
            </Text>
          </TouchableOpacity>
        </View>

        {isScanning && (
          <View style={styles.scanningBadge}>
            <Text style={styles.scanningText}>🔍 SCANNING</Text>
          </View>
        )}
      </View>

      {/* ─── MIDDLE: MAP ─────────────────────────────────────────────────── */}
      <View style={styles.mapContainer}>
        {memoizedWebView}

        {/* Nav instruction */}
        {navigationInfo && (
          <View style={[styles.navOverlay, isFallback && styles.navOverlayFallback]}>
            {isFallback && (
              <Text style={styles.navOverlayFallbackBadge}>DIRECT</Text>
            )}
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={styles.navOverlayText} numberOfLines={2}>
                {navigationInfo.displayInstruction || navigationInfo.instruction}
              </Text>
              {navigationInfo.etaMinutes ? (
                <Text style={styles.navOverlayEta}>ETA: {navigationInfo.etaMinutes} min</Text>
              ) : null}
            </View>
            <Text style={styles.navOverlayDist}>
              {formatDistanceText(navigationInfo.distanceMeters || 0)}
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

        {/* Compass Overlay */}
        <View style={styles.compassContainer}>
          <Animated.View style={[styles.compassCircle, { transform: [{ rotate: rotation }] }]}>
            <View style={styles.compassNeedleNorth} />
            <View style={styles.compassNeedleSouth} />
            <Text style={[styles.compassMarker, { top: -2 }]}>N</Text>
            <Text style={[styles.compassMarker, { bottom: -2, transform: [{ rotate: '180deg' }] }]}>S</Text>
            <Text style={[styles.compassMarker, { right: -2, transform: [{ rotate: '90deg' }] }]}>E</Text>
            <Text style={[styles.compassMarker, { left: -2, transform: [{ rotate: '270deg' }] }]}>W</Text>
          </Animated.View>
        </View>
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

      {/* ─── PROFILE MODAL ────────────────────────────────────────────── */}
      <Modal
        visible={showProfile}
        transparent
        animationType="fade"
        onRequestClose={() => setShowProfile(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={{ flex: 1 }} 
            onPress={() => setShowProfile(false)}
            activeOpacity={1}
          />
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Your Profile</Text>
                <Text style={{ color: '#666', fontSize: 13 }}>Personalize your Lily experience</Text>
              </View>
              <TouchableOpacity onPress={() => setShowProfile(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalList}>
              <Text style={styles.settingLabel}>Display Name</Text>
              <TouchableOpacity 
                style={styles.settingItem} 
                onPress={() => {
                  const newName = profile.name === 'Student' ? 'Krish' : 'Student';
                  setProfile(p => ({ ...p, name: newName }));
                }}
              >
                <Text style={styles.settingItemText}>{profile.name}</Text>
                <Text style={{ color: '#3b82f6' }}>Change</Text>
              </TouchableOpacity>

              <Text style={styles.settingLabel}>Walking Pace</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
                {['Steady', 'Quick', 'Power'].map((speed, i) => {
                  const values = [1.2, 1.4, 1.8];
                  const isActive = profile.walkingSpeed === values[i];
                  return (
                    <TouchableOpacity 
                      key={speed}
                      style={[styles.speedOption, isActive && styles.speedOptionActive]}
                      onPress={() => setProfile(p => ({ ...p, walkingSpeed: values[i] }))}
                    >
                      <Text style={[styles.speedOptionText, isActive && styles.speedOptionTextActive]}>{speed}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.settingLabel}>Quick Home Location</Text>
              <TouchableOpacity style={styles.settingItem}>
                <Text style={styles.settingItemText}>
                  {profile.homeBuildingId ? getLocationById(profile.homeBuildingId)?.name : 'Not set'}
                </Text>
                <Text style={{ color: '#3b82f6' }}>Setup</Text>
              </TouchableOpacity>

              <View style={styles.profileStats}>
                <View style={styles.statBox}>
                  <Text style={styles.statVal}>3.2km</Text>
                  <Text style={styles.statLabel}>Guided</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statVal}>12</Text>
                  <Text style={styles.statLabel}>Hazards Spotted</Text>
                </View>
              </View>

              <TouchableOpacity 
                style={styles.signOutButton}
                onPress={() => setShowProfile(false)}
              >
                <Text style={styles.signOutText}>Save Preferences</Text>
              </TouchableOpacity>
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
  profileButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(26, 26, 42, 0.85)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  profileButtonText: { fontSize: 18 },
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
  navOverlayText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  navOverlayEta: { color: '#93c5fd', fontSize: 13, fontWeight: '600', marginTop: 2 },
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

  // Compass
  compassContainer: {
    position: 'absolute',
    top: 64,
    right: 12,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(26, 26, 42, 0.85)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#333',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  compassCircle: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  compassNeedleNorth: {
    position: 'absolute',
    top: 4,
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#ef4444', // Red-500
  },
  compassNeedleSouth: {
    position: 'absolute',
    bottom: 4,
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderTopWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#f3f4f6', // Gray-100
  },
  compassMarker: {
    position: 'absolute',
    color: '#9ca3af',
    fontSize: 8,
    fontWeight: '900',
  },
});

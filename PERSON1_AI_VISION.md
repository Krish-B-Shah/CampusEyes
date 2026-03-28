# CampusEyes — Person 1 Tasks
## Branch: `feature/ai-vision`
### Owner: AI + Vision + Conversation

---

## Your Responsibility
You own everything AI-related:
- Gemini Vision integration
- Conversation history
- Voice input/output
- All 3 modes (Navigate, Read, Identify)
- Panic button
- Wiring it all into MobileModeScreen

---

## Setup First

```bash
git checkout -b feature/ai-vision
npm install expo-file-system
```

Add your Gemini API key to a new file `.env` in root:
```
GEMINI_API_KEY=your_key_here
```

Get a free Gemini API key at: https://aistudio.google.com

---

## Task 1 — Rewrite detectionService.js

Replace the entire file with this. This kills TensorFlow and
brings in Gemini Vision:

```javascript
// src/services/detectionService.js

import * as FileSystem from 'expo-file-system';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_KEY_HERE';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const SYSTEM_PROMPT = `You are CampusEyes — a navigation guide for a blind college student.

When given an image, always respond in this exact order:
1. HAZARDS — anything dangerous within 5 feet, immediately
2. PATH — is center path clear? Exact distance ahead
3. LEFT — obstacles, doors, signs, people
4. RIGHT — obstacles, doors, signs, people
5. TEXT — any readable signs, room numbers, labels
6. ACTION — one clear recommendation

Rules:
- Always give distance estimates. Never say "nearby" — say "4 feet"
- Flag moving objects separately from static ones
- Be brief, be specific, be calm
- For follow-up questions, use the same image context
- If memory context provided, reference it naturally`;

export const analyzeScene = async ({
  imageUri,
  mode = 'navigate',
  conversationHistory = [],
  memoryContext = null,
  communityHazards = [],
  destination = null,
  userQuestion = null,
}) => {
  try {
    // Convert image to base64
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Build context string
    let contextText = `Mode: ${mode.toUpperCase()}.`;
    if (destination) contextText += ` User destination: ${destination}.`;
    if (memoryContext) contextText += ` Memory from previous visits: ${memoryContext}`;
    if (communityHazards.length > 0) {
      contextText += ` Community reported hazards nearby: ${communityHazards.map(h => h.description).join(', ')}.`;
    }
    if (userQuestion) contextText += ` User question: ${userQuestion}`;

    // Build mode-specific instruction
    const modeInstruction = getModeInstruction(mode);

    // Build messages array with conversation history
    const messages = [
      // System context as first user message (Gemini style)
      {
        role: 'user',
        parts: [{ text: SYSTEM_PROMPT }]
      },
      {
        role: 'model',
        parts: [{ text: 'Understood. I am CampusEyes, ready to guide.' }]
      },
      // Previous conversation history
      ...conversationHistory,
      // Current message with image
      {
        role: 'user',
        parts: [
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data: base64,
            },
          },
          {
            text: `${modeInstruction}\n\n${contextText}`,
          },
        ],
      },
    ];

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: messages }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Gemini API error');
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('No response from Gemini');

    return text;

  } catch (error) {
    console.error('analyzeScene error:', error);
    return 'I had trouble analyzing the scene. Please try scanning again.';
  }
};

const getModeInstruction = (mode) => {
  switch (mode) {
    case 'navigate':
      return 'Analyze this scene for navigation. Describe hazards, path, left, right, visible text, and give one clear action recommendation.';
    case 'read':
      return 'Read ALL visible text in this image exactly as it appears. Describe where each piece of text is located.';
    case 'identify':
      return 'Identify the main object the user is pointing at. Give its location, size, color, and any relevant details.';
    case 'panic':
      return 'The user is completely lost. Identify the most prominent landmark visible. Give exact location relative to that landmark. Tell them how to reorient toward their destination.';
    case 'followup':
      return 'Answer the user question based on the image already analyzed. Do not re-describe the full scene.';
    default:
      return 'Analyze this scene and provide helpful navigation guidance.';
  }
};

// Keep a conversation turn in history format
export const buildHistoryTurn = (imageBase64, aiResponse) => ({
  user: {
    role: 'user',
    parts: [
      { inline_data: { mime_type: 'image/jpeg', data: imageBase64 }},
      { text: 'Scene analyzed.' }
    ]
  },
  model: {
    role: 'model',
    parts: [{ text: aiResponse }]
  }
});
```

---

## Task 2 — Rewrite speechService.js

```javascript
// src/services/speechService.js

import * as Speech from 'expo-speech';

const SPEECH_COOLDOWN = 2000;
let lastSpeechTime = 0;
let isSpeaking = false;

export const speak = (text, force = false) => {
  return new Promise((resolve) => {
    const now = Date.now();
    if (!force && now - lastSpeechTime < SPEECH_COOLDOWN) {
      resolve();
      return;
    }

    lastSpeechTime = now;
    isSpeaking = true;

    Speech.stop();
    Speech.speak(text, {
      language: 'en-US',
      pitch: 1.0,
      rate: 0.95,
      onDone: () => {
        isSpeaking = false;
        resolve();
      },
      onError: () => {
        isSpeaking = false;
        resolve();
      },
    });
  });
};

export const stopSpeaking = () => {
  Speech.stop();
  isSpeaking = false;
};

export const getIsSpeaking = () => isSpeaking;
```

---

## Task 3 — Rewrite MobileModeScreen.js

Replace the entire screen with this clean version:

```javascript
// src/screens/MobileModeScreen.js

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, Alert
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
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
  const [selectedDestination, setSelectedDestination] = useState(null);
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

  // --- PERMISSIONS ---
  useEffect(() => {
    requestCameraPermission();
    requestLocationPermission();
  }, []);

  const requestLocationPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      setLocationPermission(true);
      startLocationTracking();
    }
  };

  // --- LOCATION TRACKING ---
  const startLocationTracking = async () => {
    await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 2 },
      (loc) => setCurrentLocation(loc.coords)
    );
  };

  // --- NAVIGATION UPDATES ---
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

  // --- MAIN SCAN ---
  const handleScan = async () => {
    if (!cameraRef.current || isScanning) return;
    setIsScanning(true);
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
```

---

## Task 4 — Integration Points With Person 2

Person 2 will give you two things. You just need to receive them:

In your screen state you already have:
```javascript
const [memoryContext, setMemoryContext] = useState(null);
const [communityHazards, setCommunityHazards] = useState([]);
```

Person 2 will export functions from their services. You call them like this after each scan:

```javascript
// After successful scan — save memory
import { saveLocationMemory, getLocationMemory } from '../services/memoryService';
import { getNearbyHazards } from '../services/hazardService';

// After scan completes:
if (currentLocation) {
  const locKey = `${Math.round(currentLocation.latitude * 1000)}_${Math.round(currentLocation.longitude * 1000)}`;
  await saveLocationMemory(locKey, response);
  
  const memory = await getLocationMemory(locKey);
  if (memory) setMemoryContext(memory.description);
  
  const hazards = await getNearbyHazards(currentLocation.latitude, currentLocation.longitude);
  setCommunityHazards(hazards || []);
}
```

---

## Task 5 — Test Checklist

Before merging your branch, verify:

- [ ] App opens without crashing
- [ ] Camera shows live feed
- [ ] Tap SCAN → Gemini responds within 3 seconds
- [ ] Response is read aloud via TTS
- [ ] Mode toggle switches between Navigate / Read / Identify
- [ ] Navigate mode describes obstacles and path
- [ ] Read mode reads visible text
- [ ] Identify mode identifies objects
- [ ] Panic button scans and reorients
- [ ] Response shown in text box on screen
- [ ] Conversation history carries across follow-up questions

---

## Branch Merge Checklist

```bash
# When done
git add .
git commit -m "feat: Gemini Vision integration, conversation, all modes, panic button"
git push origin feature/ai-vision

# Then tell Person 2 you are ready to integrate
```

---

## Common Errors + Fixes

| Error | Fix |
|---|---|
| `API key not valid` | Double check GEMINI_API_KEY in .env |
| `Cannot read property of undefined` | Gemini response structure changed — log `data` and check `candidates[0]` |
| `Camera not ready` | Add `onCameraReady` handler and disable scan until ready |
| `base64 too large` | Lower quality in `takePictureAsync` to 0.5 |
| `Speech not working` | Check expo-speech is installed: `npx expo install expo-speech` |

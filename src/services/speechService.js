import * as Speech from 'expo-speech';

const SPEECH_COOLDOWN_MS = 2000;
let lastSpeechTime = 0;
let isSpeaking = false;
let currentSpeechTask = null;

export const speak = (text, force = false) => {
  return new Promise((resolve) => {
    if (!text) { resolve(); return; }

    const now = Date.now();

    // Skip if already speaking and not forced
    if (isSpeaking && !force) {
      resolve();
      return;
    }

    // Throttle non-forced speech
    if (!force && now - lastSpeechTime < SPEECH_COOLDOWN_MS) {
      resolve();
      return;
    }

    // Stop any ongoing speech before starting new one
    if (isSpeaking) {
      Speech.stop();
    }

    lastSpeechTime = now;
    isSpeaking = true;

    Speech.speak(text, {
      language: 'en-US',
      pitch: 1.0,
      rate: 0.95,
      onDone: () => {
        isSpeaking = false;
        currentSpeechTask = null;
        resolve();
      },
      onError: () => {
        isSpeaking = false;
        currentSpeechTask = null;
        resolve();
      },
      onCancel: () => {
        isSpeaking = false;
        currentSpeechTask = null;
      },
    });
  });
};

export const stopSpeaking = () => {
  Speech.stop();
  isSpeaking = false;
  currentSpeechTask = null;
};

export const getIsSpeaking = () => isSpeaking;

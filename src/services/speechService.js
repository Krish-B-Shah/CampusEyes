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

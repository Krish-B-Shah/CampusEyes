import * as Speech from 'expo-speech';
import { SPEECH_COOLDOWN } from '../constants/locations';

let lastSpokenTime = 0;
let isSpeaking = false;

export async function speak(text, force = false) {
  const now = Date.now();

  // Apply cooldown unless forced
  if (!force && now - lastSpokenTime < SPEECH_COOLDOWN) {
    return;
  }

  // Stop any current speech
  if (isSpeaking) {
    await Speech.stop();
  }

  lastSpokenTime = now;
  isSpeaking = true;

  return new Promise((resolve, reject) => {
    Speech.speak(text, {
      language: 'en-US',
      rate: 0.9,
      pitch: 1.0,
      onDone: () => {
        isSpeaking = false;
        resolve();
      },
      onError: (error) => {
        isSpeaking = false;
        reject(error);
      }
    });
  });
}

export function stopSpeaking() {
  Speech.stop();
  isSpeaking = false;
}

export function formatDetectionSpeech(detections) {
  if (!detections || detections.length === 0) {
    return null;
  }

  // Group by class
  const groups = {};
  detections.forEach(d => {
    const label = d.class.toLowerCase();
    groups[label] = (groups[label] || 0) + 1;
  });

  const parts = Object.entries(groups).map(([obj, count]) => {
    if (count === 1) {
      return obj;
    } else {
      return `${count} ${obj}s`;
    }
  });

  const joined = parts.join(' and ');
  return `There is a ${joined}`;
}

export function formatPositionSpeech(object, bbox, screenWidth) {
  const [x, y, width, height] = bbox;
  const centerX = x + width / 2;
  const screenCenter = screenWidth / 2;

  const xDiff = centerX - screenCenter;
  const xPercent = (xDiff / screenCenter) * 100;

  let position = '';
  if (Math.abs(xPercent) < 20) {
    position = 'ahead';
  } else if (xPercent > 0) {
    position = 'slightly right';
  } else {
    position = 'slightly left';
  }

  return `${object} ${position}`;
}

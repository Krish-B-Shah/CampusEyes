import * as Speech from 'expo-speech';

const SPEECH_COOLDOWN_MS = 500;
let lastSpeechTime = 0;
let isSpeaking = false;
let currentUtteranceId = null;
let selectedVoiceId = null; // set on first init

// ─── Preferred female voices (iOS priority order) ─────────────────────────────
const PREFERRED_FEMALE_VOICES = [
  'com.apple.voice.premium.en-US.Ava',       // Premium Ava — most natural
  'com.apple.voice.enhanced.en-US.Ava',      // Enhanced Ava
  'com.apple.voice.premium.en-US.Samantha',  // Premium Samantha
  'com.apple.ttsbundle.Samantha-premium',
  'com.apple.voice.compact.en-US.Samantha',  // Compact Samantha (always available)
  'com.apple.ttsbundle.Samantha-compact',
];

// ─── Init: find the best female voice available on this device ────────────────
export const initVoice = async () => {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    
    // Log all English voices so we can see what's available on this device
    const englishVoices = voices.filter(v => v.language?.startsWith('en'));
    console.log('=== Available English Voices ===');
    englishVoices.forEach(v => console.log(`  [${v.quality}] ${v.name} — ${v.identifier}`));
    console.log('================================');

    // Try preferred voices in priority order
    for (const preferred of PREFERRED_FEMALE_VOICES) {
      const found = voices.find(v => v.identifier === preferred);
      if (found) {
        selectedVoiceId = found.identifier;
        console.log('Lily voice selected:', found.name);
        return;
      }
    }
    // Fallback: any enhanced/premium en-US female-sounding voice
    const fallback = voices.find(v =>
      v.language?.startsWith('en') &&
      (v.quality === 'Enhanced' || v.quality === 'Premium') &&
      (v.name?.toLowerCase().includes('ava') ||
       v.name?.toLowerCase().includes('samantha') ||
       v.name?.toLowerCase().includes('karen') ||
       v.name?.toLowerCase().includes('victoria') ||
       v.name?.toLowerCase().includes('allison') ||
       v.name?.toLowerCase().includes('susan'))
    );
    if (fallback) {
      selectedVoiceId = fallback.identifier;
      console.log('Lily voice fallback:', fallback.name);
    } else {
      // Last resort: any Enhanced/Premium English voice
      const anyEnhanced = voices.find(v => v.language?.startsWith('en') && (v.quality === 'Enhanced' || v.quality === 'Premium'));
      if (anyEnhanced) {
        selectedVoiceId = anyEnhanced.identifier;
        console.log('Lily voice (any enhanced):', anyEnhanced.name);
      } else {
        console.log('Using system default voice');
      }
    }
  } catch (e) {
    console.warn('Voice init error:', e);
  }
};

// ─── Speak ────────────────────────────────────────────────────────────────────
export const speak = (text, force = false) => {
  if (!text) return Promise.resolve();

  const now = Date.now();

  if (isSpeaking && !force) {
    if (now - lastSpeechTime < SPEECH_COOLDOWN_MS) {
      return Promise.resolve();
    }
    Speech.stop();
  }

  lastSpeechTime = now;
  isSpeaking = true;

  return new Promise((resolve) => {
    Speech.speak(text, {
      language: 'en-US',
      voice: selectedVoiceId || undefined, // use selected female voice if found
      pitch: 1.1,    // slightly higher pitch for Lily's warm tone
      rate: 0.95,    // natural conversational pace
      onDone: () => {
        isSpeaking = false;
        currentUtteranceId = null;
        resolve();
      },
      onError: () => {
        isSpeaking = false;
        currentUtteranceId = null;
        resolve();
      },
      onCancel: () => {
        isSpeaking = false;
        currentUtteranceId = null;
      },
      onStart: (utteranceId) => {
        currentUtteranceId = utteranceId;
      },
    });
  });
};

export const stopSpeaking = () => {
  Speech.stop();
  isSpeaking = false;
  currentUtteranceId = null;
};

export const getIsSpeaking = () => isSpeaking;

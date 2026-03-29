import { Audio } from 'expo-audio';
import { transcribeAudio } from './sttService';

// ─── STT Cooldown — prevents burning through Gemini quota ──────────────────
const STT_COOLDOWN_MS = 3000;
let lastSttTime = 0;

// ─── Command vocabulary ───────────────────────────────────────────────────

const COMMAND_PATTERNS = {
  navigate: [/navigate|navigation|nav/i, /go to navigate/i],
  read: [/read|reading/i, /go to read/i],
  identify: [/identify|what is that|what's that/i, /go to identify/i, /go to id/i],
  scan: [/scan|look|analyze|what do you see/i, /look at this/i],
  repeat: [/repeat|say again|what did you say|where am i|what's around/i],
  help: [/help|commands|what can i say/i, /list commands/i],
  panic: [/i.?m lost|i am lost|help me|emergency|panic/i],
  stop: [/stop|cancel|quiet|shut up/i],
};

/**
 * Parses transcribed text into a command object.
 * @param {string} text
 * @returns {{ command: string|null, args: string[] }}
 */
export const parseCommand = (text) => {
  if (!text) return { command: null, args: [] };

  const lower = text.toLowerCase().trim();

  for (const [cmd, patterns] of Object.entries(COMMAND_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(lower)) {
        return { command: cmd, args: [lower] };
      }
    }
  }

  return { command: 'destination', args: [lower] };
};

// ─── Permission ────────────────────────────────────────────────────────────

export const requestMicPermission = async () => {
  const { status } = await Audio.requestPermissionsAsync();
  return status === 'granted';
};

// ─── Recording state ───────────────────────────────────────────────────────

let recording = null;
let isRecordingActive = false;

/**
 * Full listen cycle: record → transcribe → parse → call onCommand.
 * Includes a 3-second cooldown to prevent Gemini quota exhaustion.
 * @param {function} onCommand - called with { command, args }
 * @param {function} onListening - called with boolean (listening state)
 */
export const listenOnce = async (onCommand, onListening) => {
  if (isRecordingActive) return;

  // Cooldown guard — prevents STT spam
  const now = Date.now();
  if (now - lastSttTime < STT_COOLDOWN_MS) {
    onCommand({ command: 'error', args: ['please wait a moment before speaking again'] });
    return;
  }

  const granted = await requestMicPermission();
  if (!granted) {
    onCommand({ command: 'error', args: ['microphone permission denied'] });
    return;
  }

  try {
    onListening(true);

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const { recording: rec } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );

    recording = rec;
    isRecordingActive = true;

    // Record for up to 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));

    await rec.stopAndUnloadAsync();
    isRecordingActive = false;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    const uri = rec.getURI();
    if (!uri) {
      onListening(false);
      return;
    }

    lastSttTime = Date.now();
    const text = await transcribeAudio(uri);
    onListening(false);

    if (text) {
      const parsed = parseCommand(text);
      onCommand(parsed);
    }
  } catch (err) {
    isRecordingActive = false;
    onListening(false);
    console.error('listenOnce error:', err);
  }
};

export const getIsRecording = () => isRecordingActive;

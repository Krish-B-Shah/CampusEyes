import { AudioModule, requestRecordingPermissionsAsync, setAudioModeAsync, RecordingPresets } from 'expo-audio';
import { transcribeAudio } from './sttService';

// ─── Cooldown — prevents Gemini quota exhaustion ─────────────────────────────
const STT_COOLDOWN_MS = 5000;
let lastSttTime = 0;

// ─── Command vocabulary ──────────────────────────────────────────────────────

const COMMAND_PATTERNS = {
  navigate: [/navigate|navigation|nav|route|go to|take me to|i want to go|find/i],
  question: [/where is|where's|what is|what's|is there|can you see|do you see|locate|find the|show me|tell me|how far|which direction/i],
  read: [/read|reading/i],
  identify: [/identify|what is this/i],
  scan: [/scan|look|analyze|what do you see|look at this/i],
  repeat: [/repeat|say again|what did you say|where am i|what's around/i],
  help: [/help|commands|what can i say|list commands/i],
  panic: [/i.?m lost|i am lost|help me|emergency|panic/i],
  stop: [/stop|cancel|quiet|shut up/i],
};

// ─── Parse transcribed text into a command ─────────────────────────────────

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

  return { command: null, args: [lower] };
};

// ─── Permission ─────────────────────────────────────────────────────────────

export const requestMicPermission = async () => {
  const { status } = await requestRecordingPermissionsAsync();
  return status === 'granted';
};

// ─── Recording state ───────────────────────────────────────────────────────

let recording = null;
let isRecordingActive = false;

export const getIsRecording = () => isRecordingActive;

// ─── Full listen cycle ─────────────────────────────────────────────────────

export const listenOnce = async (onCommand, onListening) => {
  if (isRecordingActive) return;

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

  isRecordingActive = true;
  onListening(true);

  try {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    const rec = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
    recording = rec;
    await rec.prepareToRecordAsync();
    rec.record();

    // Fixed 5-second window
    await new Promise(resolve => setTimeout(resolve, 5000));

    await rec.stop();
    await setAudioModeAsync({ allowsRecording: false });
    isRecordingActive = false;

    const uri = rec.uri;
    if (!uri) {
      onListening(false);
      onCommand({ command: 'error', args: ['no audio recorded'] });
      return;
    }

    lastSttTime = Date.now();
    const { text, error } = await transcribeAudio(uri);
    onListening(false);

    if (error) {
      onCommand({ command: 'error', args: [error] });
      return;
    }

    if (!text) {
      onCommand({ command: 'error', args: ['did not catch that — please try again'] });
      return;
    }

    const parsed = parseCommand(text);
    onCommand(parsed);

  } catch (err) {
    isRecordingActive = false;
    onListening(false);
    try {
      await setAudioModeAsync({ allowsRecording: false });
    } catch (_) {}
    console.error('listenOnce error:', err);
    onCommand({ command: 'error', args: ['voice recognition failed'] });
  }
};

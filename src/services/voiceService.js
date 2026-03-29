import { Audio } from 'expo-av';
import { transcribeAudio } from './sttService';

// ─── Command vocabulary ───────────────────────────────────────────────────────

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

  // Check if it matches a destination name
  return { command: 'destination', args: [lower] };
};

// ─── Permission ───────────────────────────────────────────────────────────────

export const requestMicPermission = async () => {
  const { status } = await Audio.requestPermissionsAsync();
  return status === 'granted';
};

// ─── Recording ───────────────────────────────────────────────────────────────

let recording = null;
let isRecordingActive = false;

/**
 * Starts recording audio. Calls onInterim with transcribed chunks as available.
 * @param {function} onInterim - called with partial transcription
 * @param {function} onFinal - called with final transcription
 */
export const startRecording = async (onInterim, onFinal) => {
  if (isRecordingActive) return;

  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const { recording: rec } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY,
      // onStatusUpdate — expo-av doesn't stream transcriptions mid-recording,
      // so we record a clip and transcribe on stop
      undefined,
      100, // update interval ms (not used for transcription)
    );

    recording = rec;
    isRecordingActive = true;
  } catch (err) {
    console.error('startRecording error:', err);
  }
};

/**
 * Stops the current recording and returns the URI.
 * @returns {Promise<string|null>}
 */
export const stopRecording = async () => {
  if (!recording || !isRecordingActive) return null;

  try {
    isRecordingActive = false;
    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    const uri = recording.getURI();
    recording = null;
    return uri;
  } catch (err) {
    console.error('stopRecording error:', err);
    recording = null;
    isRecordingActive = false;
    return null;
  }
};

/**
 * Full listen cycle: record → transcribe → parse → call onCommand.
 * @param {function} onCommand - called with { command, args }
 * @param {function} onListening - called with boolean (listening state)
 */
export const listenOnce = async (onCommand, onListening) => {
  if (isRecordingActive) return;

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

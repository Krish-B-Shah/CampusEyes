import * as FileSystem from 'expo-file-system';

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const STT_SYSTEM_PROMPT = `You are a speech-to-text transcription service. The user is speaking a voice command into a mobile navigation app. Your ONLY job is to transcribe their speech EXACTLY as spoken — no interpretation, no corrections. Return only the exact transcribed text in lowercase. Keep it brief.`;
const STT_USER_PROMPT = `Transcribe this voice command exactly as spoken:`;

/**
 * Sends audio to Gemini and returns transcribed text or an error.
 * @param {string} audioUri - local file URI from expo-audio recording
 * @returns {{ text: string, error: string|null }}
 */
export const transcribeAudio = async (audioUri) => {
  if (!GEMINI_API_KEY) {
    return { text: '', error: 'Gemini API key not configured' };
  }

  try {
    const base64 = await FileSystem.readAsStringAsync(audioUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const messages = [
      { role: 'user', parts: [{ text: STT_SYSTEM_PROMPT }] },
      { role: 'model', parts: [{ text: 'Understood. I will transcribe exactly as spoken.' }] },
      { role: 'user', parts: [
        { inline_data: { mime_type: 'audio/mp4', data: base64 } },
        { text: STT_USER_PROMPT },
      ]},
    ];

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: messages }),
    });

    const data = await response.json();

    if (!response.ok) {
      const msg = data?.error?.message || `HTTP ${response.status}`;
      return { text: '', error: msg };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return { text: text || '', error: null };

  } catch (err) {
    console.error('transcribeAudio error:', err);
    return { text: '', error: 'Transcription failed — check your connection' };
  }
};

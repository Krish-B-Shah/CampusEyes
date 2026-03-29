import * as FileSystem from 'expo-file-system';

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || 'YOUR_KEY_HERE';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const STT_SYSTEM_PROMPT = `You are a speech-to-text transcription service. The user is speaking a voice command into a mobile app called CampusEyes. Your ONLY job is to transcribe their speech EXACTLY as spoken — no interpretation, no suggestions, no corrections. Return only the exact transcribed text. Keep it brief, lowercase, and natural speech as spoken.`;
const STT_USER_PROMPT = `Transcribe this voice command exactly as spoken:`;

/**
 * Sends an audio file to Gemini and returns the transcribed text.
 * @param {string} audioUri - local file URI from expo-av recording
 * @returns {Promise<string>} - transcribed text
 */
export const transcribeAudio = async (audioUri) => {
  try {
    const base64 = await FileSystem.readAsStringAsync(audioUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const messages = [
      { role: 'user', parts: [{ text: STT_SYSTEM_PROMPT }] },
      { role: 'model', parts: [{ text: 'Understood. I will transcribe exactly as spoken.' }] },
      { role: 'user', parts: [
        {
          inline_data: {
            mime_type: 'audio/mp4',
            data: base64,
          },
        },
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
      throw new Error(data.error?.message || 'STT API error');
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text || '';

  } catch (error) {
    console.error('transcribeAudio error:', error);
    return '';
  }
};

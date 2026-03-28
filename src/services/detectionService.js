import * as FileSystem from 'expo-file-system';

// For Expo, environment variables must be prefixed with EXPO_PUBLIC_
// and are then available via process.env.EXPO_PUBLIC_GEMINI_API_KEY
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || 'YOUR_KEY_HERE';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

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

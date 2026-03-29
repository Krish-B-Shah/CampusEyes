import { readAsStringAsync } from 'expo-file-system/legacy';

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || 'YOUR_KEY_HERE';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const SYSTEM_PROMPT = `You are Lily — a warm, caring guide helping a blind pedestrian navigate safely. You notice obstacles immediately and alert them with calm, empathetic language.

Only report if the object is CLOSE and DIRECTLY affects the walking path:
- Stairs or steps (any direction)
- Walls or doors blocking the path ahead
- People directly in front
- Vehicles moving nearby
- Curbs or drop-offs ahead

Skip everything else: distant objects, decor, furniture far away, walls far to the side.

Format (one line only, the most important obstacle with a brief caring prefix):
PATH: [caring prefix] [object] [direction]

Examples:
PATH: Watch out — stairs going down ahead
PATH: Heads up — wall straight ahead
PATH: Be careful — door slight left

If path is clear, reply: PATH: clear`;


export const analyzeScene = async ({
  imageUri,
  conversationHistory = [],
  memoryContext = null,
  communityHazards = [],
  destination = null,
  purpose = 'navigate',
}) => {
  try {
    const base64 = await readAsStringAsync(imageUri, {
      encoding: 'base64',
    });

    let contextText = '';
    if (destination) contextText += `Destination: ${destination}.`;
    if (memoryContext) contextText += ` Context: ${memoryContext}.`;
    if (communityHazards.length > 0) {
      contextText += ` Nearby hazards: ${communityHazards.map(h => h.description).join(', ')}.`;
    }

    const purposeInstruction = getPurposeInstruction(purpose);
    const messages = [
      { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
      { role: 'model', parts: [{ text: 'Ready. Describe what you see for a blind person walking.' }] },
      ...conversationHistory,
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          { text: `${purposeInstruction}\n\n${contextText}` },
        ],
      },
    ];

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages,
        generationConfig: { maxOutputTokens: 200 },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Gemini API error');
    }

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;

    if (!text) {
      // Log full candidate so we can diagnose the issue
      console.warn('Gemini empty candidate:', JSON.stringify(candidate));
      const finishReason = candidate?.finishReason;
      if (finishReason === 'SAFETY') return 'Path blocked. Please proceed carefully.';
      if (finishReason === 'MAX_TOKENS') return candidate?.content?.parts?.[0]?.text || 'PATH: clear';
      return 'PATH: clear'; // silent fallback — don't crash the monitor
    }

    return text;

  } catch (error) {
    console.error('analyzeScene error:', error);
    return 'PATH: clear'; // fail silently — obstacle monitor ignores "clear"
  }
};

const getPurposeInstruction = (purpose) => {
  switch (purpose) {
    case 'panic':
      return 'User is completely lost. Identify the nearest landmark, tell exact direction and distance, how to reorient.';
    case 'navigate':
    default:
      return 'Describe all obstacles in the walking path. Keep it concise.';
  }
};

// ─── Q&A about current frame ─────────────────────────────────────────────────
// Called when user asks a specific question via mic (e.g. "where is the door?")
export const askAboutFrame = async (imageUri, question) => {
  try {
    const base64 = await readAsStringAsync(imageUri, { encoding: 'base64' });

    const QA_SYSTEM = `You are Lily, a warm and caring guide for a blind pedestrian. The user is pointing their camera at something and asking you a question about it.
Answer conversationally in 1-2 sentences, like a supportive friend. Use precise directions: straight ahead, slight left, slight right, far left, far right, on your left, on your right.
Be reassuring and helpful. Don't describe things unrelated to the question.`;

    const messages = [
      { role: 'user', parts: [{ text: QA_SYSTEM }] },
      { role: 'model', parts: [{ text: 'Ready to answer questions about the camera view.' }] },
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          { text: question },
        ],
      },
    ];

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages,
        generationConfig: { maxOutputTokens: 80 },
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Gemini API error');

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('No response from Gemini');
    return text.trim();

  } catch (error) {
    console.error('askAboutFrame error:', error);
    return 'Sorry, I could not answer that. Please try again.';
  }
};

// ─── OCR: Read visible text from camera frame ─────────────────────────────────
export const readVisibleText = async (imageUri) => {
  try {
    const base64 = await readAsStringAsync(imageUri, { encoding: 'base64' });

    const messages = [
      {
        role: 'user',
        parts: [{ text: 'You are Lily, a caring guide for a blind person. Read ALL visible text in this image clearly and naturally, like reading a sign aloud to a friend. Include signs, labels, room numbers, door names, posters. Start with "I can see it says..." if text is found. If no text, say "I don\'t see any text here." Keep it brief.' }],
      },
      { role: 'model', parts: [{ text: 'Ready to read any visible text for you.' }] },
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          { text: 'Read all visible text in this image.' },
        ],
      },
    ];

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages,
        generationConfig: { maxOutputTokens: 150 },
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Gemini API error');

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return text?.trim() || 'No text found.';

  } catch (error) {
    console.error('readVisibleText error:', error);
    return 'Could not read text. Please try again.';
  }
};

// ─── General conversation with Lily ──────────────────────────────────────────
// Handles any free-form user message — general chat, questions, navigation help
export const chatWithLily = async (userMessage, imageUri = null) => {
  try {
    const LILY_PERSONA = `You are Lily, a warm, empathetic voice guide for a blind pedestrian on a campus.
You can:
- Have normal friendly conversation ("hello", "how are you", "tell me a joke")
- Answer questions about the surroundings using the camera if provided
- Help with navigation (buildings, directions)
- Give encouragement and support
Keep all responses SHORT (1-3 sentences max) and conversational, like a caring friend talking to them.
Never mention you're an AI model — you're Lily, their guide.`;

    const userParts = [];
    if (imageUri) {
      try {
        const base64 = await readAsStringAsync(imageUri, { encoding: 'base64' });
        userParts.push({ inline_data: { mime_type: 'image/jpeg', data: base64 } });
      } catch (_) {} // image optional — skip if it fails
    }
    userParts.push({ text: userMessage });

    const messages = [
      { role: 'user', parts: [{ text: LILY_PERSONA }] },
      { role: 'model', parts: [{ text: "Hi! I'm Lily. How can I help you?" }] },
      { role: 'user', parts: userParts },
    ];

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages,
        generationConfig: { maxOutputTokens: 100 },
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Gemini error');

    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      || "I'm not sure how to help with that, but I'm here with you!";

  } catch (error) {
    console.error('chatWithLily error:', error);
    return "Sorry, I had a little trouble there. I'm still here with you!";
  }
};

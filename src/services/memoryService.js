import AsyncStorage from '@react-native-async-storage/async-storage';

const MEMORY_KEY = 'campuseyes_memory';
const MAX_MEMORY_ENTRIES = 50;
const MAX_DESCRIPTION_CHARS = 500; // Prevent unbounded prompt growth

// ~10m precision — rounds to 4 decimal places
const buildLocationKey = (latitude, longitude) => {
  return `loc_${Math.round(latitude * 10000)}_${Math.round(longitude * 10000)}`;
};

// ─── Save ─────────────────────────────────────────────────────────────────

export const saveLocationMemory = async (latitude, longitude, description) => {
  try {
    const key = buildLocationKey(latitude, longitude);
    const existing = await AsyncStorage.getItem(MEMORY_KEY);
    const memory = existing ? JSON.parse(existing) : {};

    // Truncate description to prevent unbounded prompt growth
    const truncated = description.slice(0, MAX_DESCRIPTION_CHARS);

    memory[key] = {
      description: truncated,
      timestamp: Date.now(),
      visits: (memory[key]?.visits || 0) + 1,
    };

    // Trim oldest entries if over limit
    const keys = Object.keys(memory);
    if (keys.length > MAX_MEMORY_ENTRIES) {
      const sorted = [...keys].sort((a, b) => memory[a].timestamp - memory[b].timestamp);
      const toRemove = sorted.slice(0, keys.length - MAX_MEMORY_ENTRIES);
      toRemove.forEach(k => delete memory[k]);
    }

    await AsyncStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
    return { success: true };
  } catch (err) {
    console.error('saveLocationMemory error:', err);
    return { success: false, error: err.message };
  }
};

// ─── Get single location ───────────────────────────────────────────────────

export const getLocationMemory = async (latitude, longitude) => {
  try {
    const key = buildLocationKey(latitude, longitude);
    const existing = await AsyncStorage.getItem(MEMORY_KEY);
    if (!existing) return null;
    const memory = JSON.parse(existing);
    return memory[key] || null;
  } catch (err) {
    console.error('getLocationMemory error:', err);
    return null;
  }
};

// ─── Get all memory entries ────────────────────────────────────────────────

export const getAllMemory = async () => {
  try {
    const existing = await AsyncStorage.getItem(MEMORY_KEY);
    return existing ? JSON.parse(existing) : {};
  } catch (err) {
    return {};
  }
};

// ─── Delete single entry ───────────────────────────────────────────────────

export const deleteMemoryEntry = async (latitude, longitude) => {
  try {
    const key = buildLocationKey(latitude, longitude);
    const existing = await AsyncStorage.getItem(MEMORY_KEY);
    if (!existing) return;
    const memory = JSON.parse(existing);
    delete memory[key];
    await AsyncStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch (err) {
    console.error('deleteMemoryEntry error:', err);
  }
};

// ─── Format for AI prompt ──────────────────────────────────────────────────

export const formatMemoryContext = (memoryEntry) => {
  if (!memoryEntry) return null;
  const visits = memoryEntry.visits;
  const timeAgo = getTimeAgo(memoryEntry.timestamp);
  return `Previous visit${visits > 1 ? 's' : ''} to this location: ${visits}. Last: ${timeAgo}. Note: ${memoryEntry.description}`;
};

// ─── Clear all ─────────────────────────────────────────────────────────────

export const clearAllMemory = async () => {
  try {
    await AsyncStorage.removeItem(MEMORY_KEY);
  } catch (err) {
    console.error('clearAllMemory error:', err);
  }
};

// ─── Helpers ───────────────────────────────────────────────────────────────

const getTimeAgo = (timestamp) => {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

import AsyncStorage from '@react-native-async-storage/async-storage';

const MEMORY_KEY = 'campuseyes_memory';
const MAX_MEMORY_ENTRIES = 50;

// Round coordinates to ~10 meter precision for location key
const buildLocationKey = (latitude, longitude) => {
  return `loc_${Math.round(latitude * 10000)}_${Math.round(longitude * 10000)}`;
};

// Save a scan description for a location
export const saveLocationMemory = async (latitude, longitude, description) => {
  try {
    const key = buildLocationKey(latitude, longitude);
    const existing = await AsyncStorage.getItem(MEMORY_KEY);
    const memory = existing ? JSON.parse(existing) : {};

    memory[key] = {
      description,
      timestamp: Date.now(),
      visits: (memory[key]?.visits || 0) + 1,
    };

    // Trim if too many entries
    const keys = Object.keys(memory);
    if (keys.length > MAX_MEMORY_ENTRIES) {
      const oldest = keys.sort((a, b) => memory[a].timestamp - memory[b].timestamp)[0];
      delete memory[oldest];
    }

    await AsyncStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
    return true;
  } catch (err) {
    console.error('saveLocationMemory error:', err);
    return false;
  }
};

// Get memory for a location
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

// Format memory context string for AI prompt
export const formatMemoryContext = (memoryEntry) => {
  if (!memoryEntry) return null;
  const visits = memoryEntry.visits;
  const timeAgo = getTimeAgo(memoryEntry.timestamp);
  return `You have visited this location ${visits} time${visits > 1 ? 's' : ''}. Last visit: ${timeAgo}. Previous description: ${memoryEntry.description}`;
};

// Clear all memory
export const clearAllMemory = async () => {
  await AsyncStorage.removeItem(MEMORY_KEY);
};

const getTimeAgo = (timestamp) => {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  if (hours < 24) return `${hours} hours ago`;
  return `${days} days ago`;
};

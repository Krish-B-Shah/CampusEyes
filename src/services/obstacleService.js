import { analyzeScene } from './detectionService';


// ─── Live Detection Configuration ─────────────────────────────────────────────
const SCAN_INTERVAL_MS = 1500;           // scan every 1.5 seconds — maximum speed
const MIN_SCAN_INTERVAL_MS = 1200;       // guard against overlapping scans
const OBJECT_COOLDOWN_MS = 10000;        // don't re-announce same object within 10s

// ─── Critical objects for blind navigation ────────────────────────────────────
// Priority order — PATH (straight ahead) is highest, then others
const CRITICAL_TYPES = [
  'stair', 'step', 'curb',              // fall hazards — highest priority
  'door', 'entrance', 'exit', 'glass',  // navigational landmarks
  'person', 'people', 'crowd',          // moving hazards
  'car', 'vehicle', 'bike',             // traffic hazards
  'pole', 'post', 'pillar', 'column',   // collision hazards
  'wall', 'fence', 'barrier',           // blockages — always report
  'sign', 'table', 'bench',             // secondary obstacles
];

// ─── State ────────────────────────────────────────────────────────────────────
let monitorIntervalId = null;
let isScanningRef = { current: false };
let onObstaclesDetectedRef = { current: null };
let lastAnalysisTime = 0;

// Per-object cooldown: maps object type → last announced timestamp
const lastAnnouncedTimeByType = {};



// Live context refs — updated from outside so scans always use current state
let contextRefs = {
  getMemoryContext: () => null,
  getCommunityHazards: () => [],
  getDestination: () => null,
};

// ─── Context Setters ───────────────────────────────────────────────────────────
export const setObstacleContextRefs = (refs) => {
  contextRefs = { ...contextRefs, ...refs };
};

// ─── Get object base type for cooldown matching ───────────────────────────────
const getBaseType = (text) => {
  const lower = text.toLowerCase();
  for (const t of CRITICAL_TYPES) {
    if (lower.includes(t)) return t;
  }
  return null; // not a critical object — discard
};

// ─── Parse one line — returns { baseType, objectName, direction } or null ──────────────
const parseLine = (line) => {
  let raw = line.toLowerCase().trim();

  // Extract prefix direction context
  let prefixDir = null;
  if (raw.startsWith('path:')) {
    raw = raw.substring(5).trim();
  } else if (raw.startsWith('left:')) {
    raw = raw.substring(5).trim();
    prefixDir = 'on your left';
  } else if (raw.startsWith('right:')) {
    raw = raw.substring(6).trim();
    prefixDir = 'on your right';
  } else {
    raw = raw.replace(/^[a-z]+:\s*/i, '').trim();
  }

  // Strip stray distances
  raw = raw.replace(/\d+(?:\.\d+)?\s*(?:feet|ft|foot|meters?|m)\b/gi, '').trim();
  // Remove filler
  raw = raw.replace(/^(there is|there's|i see|you see|a |an |the )\s*/i, '').trim();

  if (raw.length < 2) return null;

  // Detect embedded precise direction (e.g. "wall slight left", "stairs straight ahead")
  const DIR_PATTERNS = [
    /\bstraight ahead\b/,
    /\bslight(?:ly)?\s+left\b/,
    /\bslight(?:ly)?\s+right\b/,
    /\bfar\s+left\b/,
    /\bfar\s+right\b/,
    /\bon\s+(?:your\s+)?left\b/,
    /\bon\s+(?:your\s+)?right\b/,
    /\bahead\b/,
  ];

  let direction = null;
  for (const pat of DIR_PATTERNS) {
    const m = raw.match(pat);
    if (m) {
      direction = m[0].trim();
      // Remove the direction fragment from the object name
      raw = raw.replace(pat, '').trim().replace(/,\s*$/, '').trim();
      break;
    }
  }

  // Fall back to prefix-derived direction
  if (!direction && prefixDir) direction = prefixDir;
  if (!direction) direction = 'straight ahead';

  // Determine base type
  const baseType = getBaseType(raw);
  if (!baseType) return null;

  // Capitalise object name
  const objectName = raw.charAt(0).toUpperCase() + raw.slice(1);

  return { baseType, objectName, direction };
};

// ─── Extract critical objects from Gemini response ──────────────────────────────────
const extractCriticalObjects = (responseText) => {
  const lines = responseText.split('\n').map(l => l.trim()).filter(Boolean);
  const results = [];

  // PATH first (straight-ahead obstacles have highest priority)
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith('PATH') && !upper.match(/CLEAR|EMPTY|NOTHING|NO OBSTACLE/)) {
      const parsed = parseLine(line);
      if (parsed) results.push({ ...parsed, priority: 0 });
    }
  }

  // Then LEFT and RIGHT
  for (const line of lines) {
    const upper = line.toUpperCase();
    if ((upper.startsWith('LEFT') || upper.startsWith('RIGHT')) && !upper.match(/CLEAR|EMPTY|NOTHING|NO OBSTACLE/)) {
      const parsed = parseLine(line);
      if (parsed) results.push({ ...parsed, priority: 1 });
    }
  }

  return results;
};

// ─── Group objects by type and merge directions ────────────────────────────────────
// Returns [{ baseType, announcement }] — one entry per unique object type
const groupByType = (objects) => {
  const map = new Map(); // baseType → { objectName, directions: Set }

  for (const { baseType, objectName, direction } of objects) {
    if (!map.has(baseType)) {
      map.set(baseType, { objectName, directions: new Set() });
    }
    map.get(baseType).directions.add(direction);
  }

  const grouped = [];
  for (const [baseType, { objectName, directions }] of map.entries()) {
    const dirList = [...directions];
    let announcement;
    if (dirList.length === 1) {
      announcement = `${objectName} ${dirList[0]}`;
    } else {
      // "Wall on your left, slight right, and straight ahead"
      const last = dirList.pop();
      announcement = `${objectName} ${dirList.join(', ')}, and ${last}`;
    }
    grouped.push({ baseType, announcement });
  }

  return grouped;
};



// ─── Obstacle Monitor ─────────────────────────────────────────────────────────
export const startObstacleMonitor = (cameraRef, options = {}) => {
  if (monitorIntervalId) return;

  const { onObstacles, onHaptic } = options;

  isScanningRef.current = false;
  onObstaclesDetectedRef.current = onObstacles || null;

  const scan = async () => {
    const now = Date.now();

    if (isScanningRef.current || !cameraRef?.current) return;
    if (now - lastAnalysisTime < MIN_SCAN_INTERVAL_MS) return;

    isScanningRef.current = true;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.2,
        skipProcessing: true,
        shutterSound: false,
      });

      if (!photo?.uri) { isScanningRef.current = false; return; }

      const memoryContext = contextRefs.getMemoryContext();
      const communityHazards = contextRefs.getCommunityHazards();
      const destination = contextRefs.getDestination();

      const responseText = await analyzeScene({
        imageUri: photo.uri,
        purpose: 'navigate',
        conversationHistory: [],
        memoryContext,
        communityHazards,
        destination,
      });

      lastAnalysisTime = now;

      if (!responseText || responseText.includes('trouble analyzing')) return;

      // Extract, group, and merge directions per object type
      const objects = extractCriticalObjects(responseText);
      if (objects.length === 0) return;

      const grouped = groupByType(objects);

      // Filter out types that were announced recently (per-type cooldown)
      const newAnnouncements = grouped.filter(({ baseType }) => {
        const lastTime = lastAnnouncedTimeByType[baseType] || 0;
        return (now - lastTime) >= OBJECT_COOLDOWN_MS;
      });

      if (newAnnouncements.length === 0) return;

        // Announce each unique object type instantly (directions already merged)
        for (const { baseType, announcement } of newAnnouncements) {
          lastAnnouncedTimeByType[baseType] = now;
          const isHighDanger = ['stair', 'step', 'curb', 'car', 'vehicle'].includes(baseType);
          // Fire haptic via UI-thread callback (avoids background context issues)
          if (onHaptic) onHaptic(isHighDanger);
          if (onObstaclesDetectedRef.current) {
            onObstaclesDetectedRef.current([], announcement);
          }
        }

    } catch (err) {
      // Silently skip — usually "Image could not be captured" during camera warmup
      if (!err?.message?.includes('could not be captured')) {
        console.error('Obstacle scan error:', err);
      }
    } finally {
      isScanningRef.current = false;
    }
  };

  // Start scanning
  monitorIntervalId = setInterval(scan, SCAN_INTERVAL_MS);
  // First scan after 1.5 seconds (camera needs time to warm up)
  setTimeout(scan, 1500);
};

// ─── Stop Monitor ─────────────────────────────────────────────────────────────
export const stopObstacleMonitor = () => {
  if (monitorIntervalId) {
    clearInterval(monitorIntervalId);
    monitorIntervalId = null;
  }
  isScanningRef.current = false;
  onObstaclesDetectedRef.current = null;
};

// ─── Clear Memory ─────────────────────────────────────────────────────────────
export const clearObstacleMemory = () => {
  Object.keys(lastAnnouncedTimeByType).forEach(k => delete lastAnnouncedTimeByType[k]);
};

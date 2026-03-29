import { analyzeScene } from './detectionService';

// Tracks previously announced obstacles to avoid repetition
const announcedObstacles = new Map(); // key → { lastDistance, lastAnnouncedAt, lastDescription }
const SCAN_INTERVAL_MS = 12000;        // scan every 12 seconds
const ANNOUNCEMENT_COOLDOWN_MS = 15000; // don't re-announce same obstacle within 15s
const SIGNIFICANT_DISTANCE_CHANGE_FT = 10; // announce when distance changes by 10+ ft (closer spacing needed)

// Parse distance from Gemini's response text (e.g., "5 feet", "10 ft", "3 meters")
const parseDistance = (text) => {
  const lower = text.toLowerCase();
  // Match patterns like "5 feet", "10 ft", "3 meters", "3m"
  const match = lower.match(/(\d+(?:\.\d+)?)\s*(?:feet|ft|foot|')/);
  if (match) return parseFloat(match[1]) * 0.3048; // convert feet to meters

  const matchM = lower.match(/(\d+(?:\.\d+)?)\s*(?:meter|m\b)/);
  if (matchM) return parseFloat(matchM[1]);

  return null; // no parseable distance
};

// Extract a stable key for an obstacle based on direction and rough type
const getObstacleKey = (direction, text) => {
  const lower = text.toLowerCase();
  // Normalize to direction + first meaningful word
  const words = lower.split(/\s+/).filter(w => w.length > 3 && !['there', 'ahead', 'visible', 'about'].includes(w));
  const typeWord = words[0] || 'object';
  return `${direction}:${typeWord}`;
};

// Determine which direction category an obstacle belongs to
const getDirectionCategory = (text) => {
  const lower = text.toLowerCase();
  if (lower.includes('left')) return 'LEFT';
  if (lower.includes('right')) return 'RIGHT';
  if (lower.includes('path') || lower.includes('ahead') || lower.includes('front')) return 'PATH';
  if (lower.includes('door')) return 'DOOR';
  return 'OTHER';
};

// Parse Gemini's response text to extract structured obstacle info
const parseObstaclesFromResponse = (responseText) => {
  const obstacles = [];
  const lines = responseText.split('\n').map(l => l.trim()).filter(Boolean);

  let currentSection = 'OTHER';

  for (const line of lines) {
    const upper = line.toUpperCase();

    // Detect section headers
    if (upper.startsWith('PATH') || upper.includes('CENTER PATH') || upper.includes('PATH AHEAD')) {
      currentSection = 'PATH';
    } else if (upper.startsWith('LEFT')) {
      currentSection = 'LEFT';
    } else if (upper.startsWith('RIGHT')) {
      currentSection = 'RIGHT';
    } else if (upper.startsWith('HAZARD') || upper.includes('danger')) {
      currentSection = 'HAZARD';
    } else if (upper.startsWith('DOOR')) {
      currentSection = 'DOOR';
    }

    // Extract distance mentions from any line
    const distance = parseDistance(line);
    if (distance !== null) {
      const key = getObstacleKey(currentSection, line);
      obstacles.push({
        key,
        direction: currentSection,
        description: line,
        distanceMeters: distance,
        isHazard: currentSection === 'HAZARD',
      });
    }
  }

  return obstacles;
};

// Decide if an obstacle announcement is warranted
const shouldAnnounce = (obstacle) => {
  const existing = announcedObstacles.get(obstacle.key);
  const now = Date.now();

  if (!existing) return true; // new obstacle

  // Hazard always re-announces (dangerous)
  if (obstacle.isHazard) {
    // But still respect cooldown for the same exact hazard
    if (now - existing.lastAnnouncedAt < ANNOUNCEMENT_COOLDOWN_MS) return false;
    return true;
  }

  // Don't repeat same obstacle within cooldown
  if (now - existing.lastAnnouncedAt < ANNOUNCEMENT_COOLDOWN_MS) return false;

  // Announce if distance changed significantly
  const distanceChangeFt = Math.abs(obstacle.distanceMeters - existing.lastDistance) * 3.28084;
  if (distanceChangeFt >= SIGNIFICANT_DISTANCE_CHANGE_FT) return true;

  // Announce if description changed meaningfully
  if (obstacle.description !== existing.lastDescription) return true;

  return false;
};

// Build the announcement text for a new/changed obstacle
const buildAnnouncementText = (obstacles) => {
  const parts = [];

  // Sort: hazards first, then by distance (closest first)
  const sorted = [...obstacles].sort((a, b) => {
    if (a.isHazard && !b.isHazard) return -1;
    if (!a.isHazard && b.isHazard) return 1;
    return a.distanceMeters - b.distanceMeters;
  });

  for (const obs of sorted) {
    const feet = Math.round(obs.distanceMeters * 3.28084);
    const distText = feet < 50
      ? `${feet} feet`
      : feet < 500
        ? `about ${Math.round(feet / 10) * 10} feet`
        : `about ${Math.round(feet / 50) * 50} feet`;

    let announcement = '';
    const lower = obs.description.toLowerCase();

    if (obs.isHazard) {
      announcement = `Warning — ${obs.description}. ${distText} ahead.`;
    } else if (obs.direction === 'PATH' || obs.direction === 'OTHER') {
      announcement = `${obs.description}. ${distText} ahead.`;
    } else {
      const dir = obs.direction === 'LEFT' ? 'left' : obs.direction === 'RIGHT' ? 'right' : '';
      announcement = `${obs.description}. ${dir ? `${dir.charAt(0) + dir.slice(1)} side. ` : ''}${distText} ahead.`;
    }

    parts.push(announcement);
  }

  return parts.join(' ');
};

// ─── Obstacle Monitor ──────────────────────────────────────────────────────────
let monitorIntervalId = null;
let lastScannedAt = 0;
let isScanningRef = { current: false };
let onObstaclesDetectedRef = { current: null }; // callback(newObstacles, announcementText)

// Live context refs — updated from outside so scans always use current state
let contextRefs = {
  getMemoryContext: () => null,
  getCommunityHazards: () => [],
  getDestination: () => null,
};

export const setObstacleContextRefs = (refs) => {
  contextRefs = { ...contextRefs, ...refs };
};

export const startObstacleMonitor = (cameraRef, options = {}) => {
  if (monitorIntervalId) return; // already running

  const {
    scanIntervalMs = SCAN_INTERVAL_MS,
    onObstacles,
  } = options;

  isScanningRef.current = false;
  onObstaclesDetectedRef.current = onObstacles || null;

  const scan = async () => {
    if (isScanningRef.current || !cameraRef?.current) return;
    isScanningRef.current = true;

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: false });

      // Pull live context at scan time — not at monitor start time
      const memoryContext = contextRefs.getMemoryContext();
      const communityHazards = contextRefs.getCommunityHazards();
      const destination = contextRefs.getDestination();

      const responseText = await analyzeScene({
        imageUri: photo.uri,
        mode: 'navigate',
        conversationHistory: [],
        memoryContext,
        communityHazards,
        destination,
      });

      if (!responseText || responseText.includes('trouble analyzing')) {
        isScanningRef.current = false;
        return;
      }

      const obstacles = parseObstaclesFromResponse(responseText);

      // Check which obstacles need announcement
      const toAnnounce = obstacles.filter(shouldAnnounce);

      // Update tracking for all obstacles
      const now = Date.now();
      for (const obs of obstacles) {
        announcedObstacles.set(obs.key, {
          lastDistance: obs.distanceMeters,
          lastAnnouncedAt: now,
          lastDescription: obs.description,
        });
      }

      // Clean up old entries (not seen in 2 minutes)
      for (const [key, val] of announcedObstacles) {
        if (now - val.lastAnnouncedAt > 120000) announcedObstacles.delete(key);
      }

      // Fire callback with announcement text if anything to say
      if (toAnnounce.length > 0 && onObstaclesDetectedRef.current) {
        const announcement = buildAnnouncementText(toAnnounce);
        onObstaclesDetectedRef.current(obstacles, announcement);
      }

      lastScannedAt = now;
    } catch (err) {
      console.error('Obstacle scan error:', err);
    } finally {
      isScanningRef.current = false;
    }
  };

  // Start scanning
  monitorIntervalId = setInterval(scan, scanIntervalMs);

  // Run initial scan after 3 seconds
  setTimeout(scan, 3000);
};

export const stopObstacleMonitor = () => {
  if (monitorIntervalId) {
    clearInterval(monitorIntervalId);
    monitorIntervalId = null;
  }
  isScanningRef.current = false;
  onObstaclesDetectedRef.current = null;
};

export const clearObstacleMemory = () => {
  announcedObstacles.clear();
};

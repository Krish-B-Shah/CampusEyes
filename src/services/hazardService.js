import { calculateDistance } from './navigationService';

// In-memory hazard store (prototype — no Supabase needed)
// Hazards stored as { id, latitude, longitude, description, reportedAt }
const hazardStore = new Map();

const HAZARD_RADIUS_METERS = 100;
const HAZARD_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// ─── Clean up expired hazards ───────────────────────────────────────────────
const cleanExpired = () => {
  const now = Date.now();
  for (const [id, h] of hazardStore) {
    if (now - h.reportedAt > HAZARD_DURATION_MS) {
      hazardStore.delete(id);
    }
  }
};

// ─── Report a hazard ───────────────────────────────────────────────────────
export const reportHazard = async (latitude, longitude, description) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  hazardStore.set(id, {
    id,
    latitude,
    longitude,
    description,
    reportedAt: Date.now(),
  });
  return { data: { id }, error: null };
};

// ─── Get nearby hazards ────────────────────────────────────────────────────
export const getNearbyHazards = async (latitude, longitude) => {
  cleanExpired();
  const nearby = [];
  for (const h of hazardStore.values()) {
    const dist = calculateDistance(latitude, longitude, h.latitude, h.longitude);
    if (dist <= HAZARD_RADIUS_METERS) {
      nearby.push(h);
    }
  }
  return nearby;
};

// ─── Real-time subscription (polling-based for prototype) ────────────────
export const subscribeToHazards = (latitude, longitude, onNewHazard) => {
  let lastCount = hazardStore.size;

  const interval = setInterval(() => {
    cleanExpired();
    const current = hazardStore.size;
    if (current > lastCount) {
      // New hazard added since last check
      for (const h of hazardStore.values()) {
        const dist = calculateDistance(latitude, longitude, h.latitude, h.longitude);
        if (dist <= HAZARD_RADIUS_METERS) {
          onNewHazard(h);
        }
      }
    }
    lastCount = current;
  }, 10000); // poll every 10 seconds

  return () => clearInterval(interval);
};

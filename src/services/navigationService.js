import { LOCATIONS, NAVIGATION_CONFIG } from '../constants/locations';

// 1 meter = 3.28084 feet
const METERS_TO_FEET = 3.28084;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

export const calculateBearing = (lat1, lon1, lat2, lon2) => {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Converts meters to a human-readable feet string
const formatDistanceText = (distanceMeters) => {
  const feet = distanceMeters * METERS_TO_FEET;

  if (feet < 50) {
    return `${Math.round(feet)} feet ahead`;
  }
  if (feet < 500) {
    return `about ${Math.round(feet / 5) * 5} feet ahead`;
  }
  // Convert to yards for longer distances
  const yards = feet / 3;
  return `about ${Math.round(yards / 10) * 10} yards ahead`;
};

// OSRM walking route fetch — returns { geometry: [[lon,lat],...], steps: [{instruction, distance}], distanceMeters, durationSeconds }
export const fetchRoute = async (lat1, lon1, lat2, lon2) => {
  const url = `https://router.project-osrm.org/route/v1/foot/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson&steps=true&annotations=true`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) return null;

  const route = data.routes[0];
  const steps = (route.legs[0].steps || []).map(step => ({
    instruction: step.maneuver?.type === 'arrive'
      ? 'You have arrived at your destination.'
      : step.maneuver?.instruction || step.maneuver?.type || 'Continue walking',
    distance: step.distance, // meters
    duration: step.duration, // seconds
    way_points: step.way_points, // [startIdx, endIdx] in geometry
  }));

  return {
    geometry: route.geometry.coordinates, // [[lon, lat], ...]
    steps,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
  };
};

// ─── Navigation state ────────────────────────────────────────────────────────
// Tracks which step we're on so we only speak new instructions once
let lastSpokenStepIndex = -1;
let lastSpokenInstruction = '';

export const speakNavigationStep = (routeData, userLat, userLon) => {
  if (!routeData?.steps?.length) return null;

  // Find the step the user is currently on based on their position along the route
  let currentStepIdx = 0;
  const coords = routeData.geometry;

  if (coords.length >= 2) {
    let minDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = calculateDistance(userLat, userLon, coords[i][1], coords[i][0]);
      if (d < minDist) {
        minDist = d;
        // Find which step this coord belongs to
        for (let s = 0; s < routeData.steps.length; s++) {
          const [start, end] = routeData.steps[s].way_points || [0, 0];
          if (i >= start && i <= end) {
            currentStepIdx = s;
            break;
          }
        }
      }
    }
  }

  const currentStep = routeData.steps[currentStepIdx];
  if (!currentStep) return null;

  // Only speak if it's a new step
  if (currentStepIdx !== lastSpokenStepIndex) {
    lastSpokenStepIndex = currentStepIdx;
    lastSpokenInstruction = currentStep.instruction;
  }

  return {
    stepIndex: currentStepIdx,
    totalSteps: routeData.steps.length,
    instruction: lastSpokenInstruction,
    distanceMeters: currentStep.distance,
    routeGeometry: coords,
  };
};

export const getDirectionInstruction = (bearingDiff, distanceMeters) => {
  const { arrivalThreshold, straightThreshold } = NAVIGATION_CONFIG;

  if (distanceMeters < arrivalThreshold) {
    return "You have arrived at your destination. Tap scan to explore the entrance.";
  }

  const distText = formatDistanceText(distanceMeters);

  if (Math.abs(bearingDiff) <= straightThreshold) {
    return `Walk straight ahead. ${distText}.`;
  }
  if (bearingDiff > straightThreshold && bearingDiff <= 135) {
    return `Turn right and walk. ${distText}.`;
  }
  if (bearingDiff < -straightThreshold && bearingDiff >= -135) {
    return `Turn left and walk. ${distText}.`;
  }

  return `Turn around. ${distText} behind you.`;
};

export const calculateNavigation = (currentLocation, destination) => {
  if (!currentLocation || !destination) return null;

  const distanceMeters = calculateDistance(
    currentLocation.latitude,
    currentLocation.longitude,
    destination.latitude,
    destination.longitude
  );

  const bearing = calculateBearing(
    currentLocation.latitude,
    currentLocation.longitude,
    destination.latitude,
    destination.longitude
  );

  // Bearing diff vs absolute bearing: convert to -180..180 range
  const bearingDiff = bearing > 180 ? bearing - 360 : bearing;
  const instruction = getDirectionInstruction(bearingDiff, distanceMeters);

  return {
    distanceMeters: Math.round(distanceMeters),
    bearing: Math.round(bearing),
    instruction,
    hasArrived: distanceMeters < NAVIGATION_CONFIG.arrivalThreshold,
  };
};

export const getLocationById = (id) => {
  return LOCATIONS.find((loc) => loc.id === id) || null;
};

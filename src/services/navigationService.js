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

// Converts meters to a human-readable string like '0.5 miles' or '200 feet'
export const formatDistanceText = (distanceMeters) => {
  const feet = distanceMeters * METERS_TO_FEET;

  if (feet >= 528) {
    const miles = feet / 5280;
    return `${miles.toFixed(1)} miles`;
  }
  if (feet < 50) {
    return `${Math.round(feet)} feet`;
  }
  if (feet < 500) {
    return `${Math.round(feet / 10) * 10} feet`;
  }
  return `${Math.round(feet / 50) * 50} feet`;
};

// OSRM walking route fetch — returns { geometry: [[lon,lat],...], steps: [{instruction, distance}], distanceMeters, durationSeconds, provider }
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
    provider: 'osrm',
  };
};

// OpenRouteService pedestrian route fetch
export const fetchRouteORS = async (lat1, lon1, lat2, lon2) => {
  const apiKey = process.env.EXPO_PUBLIC_OPENROUTESERVICE_API_KEY;
  if (!apiKey) return null;

  const url = `https://api.openrouteservice.org/v2/directions/foot-walking?api_key=${apiKey}&start=${lon1},${lat1}&end=${lon2},${lat2}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/geo+json' },
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.error || !data.features?.length) return null;

    const feature = data.features[0];
    const coords = feature.geometry.coordinates;
    const props = feature.properties;

    const steps = (props.segments || []).flatMap(seg =>
      (seg.steps || []).map(step => ({
        instruction: step.instruction || 'Continue walking',
        distance: step.distance,
        duration: step.duration,
        way_points: step.way_points,
      }))
    );

    return {
      geometry: coords,
      steps,
      distanceMeters: props.distance,
      durationSeconds: props.duration,
      provider: 'ors',
    };
  } catch {
    return null;
  }
};

// Multi-provider route fetcher: ORS → OSRM → straight-line fallback
export const fetchRouteWithFallback = async (lat1, lon1, lat2, lon2) => {
  let route = await fetchRouteORS(lat1, lon1, lat2, lon2);
  if (route) return route;

  route = await fetchRoute(lat1, lon1, lat2, lon2);
  if (route) return route;

  return {
    provider: 'straight',
    geometry: [[lon1, lat1], [lon2, lat2]],
    steps: [],
    distanceMeters: calculateDistance(lat1, lon1, lat2, lon2),
    durationSeconds: null,
  };
};

// ─── Navigation state ────────────────────────────────────────────────────────
// Tracks which step we're on so we only speak new instructions once
let lastSpokenStepIndex = -1;
let lastSpokenInstruction = '';
let lastAnnouncedStepIndex = -1;

export const resetNavigationState = () => {
  lastSpokenStepIndex = -1;
  lastSpokenInstruction = '';
  lastAnnouncedStepIndex = -1;
};

export const speakNavigationStep = (routeData, userLat, userLon) => {
  if (!routeData?.steps?.length) return null;
  if (routeData.provider === 'straight') return null; // bearing fallback handles this

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

  let isNewStep = false;
  // Only speak if it's a new step and we have advanced forward (prevents boundary spam)
  if (currentStepIdx > lastSpokenStepIndex) {
    lastSpokenStepIndex = currentStepIdx;
    
    const rawInstruction = currentStep.instruction || 'Continue straight';
    const isContinue = rawInstruction.toLowerCase().includes('keep') || rawInstruction.toLowerCase().includes('continue');
    
    // Skip voice announcement for minor "continue" segments under 15 meters to prevent spam
    if (!(isContinue && currentStep.distance < 15)) {
      lastSpokenInstruction = rawInstruction;
      
      // If it's a long segment, preview next step or tell them to continue
      if (currentStep.distance >= 15 && currentStepIdx < routeData.steps.length - 1) {
         const distText = formatDistanceText(currentStep.distance);
         const nextInstruction = routeData.steps[currentStepIdx + 1]?.instruction || '';
         const isNextContinue = nextInstruction.toLowerCase().includes('keep') || nextInstruction.toLowerCase().includes('continue');
         
         if (nextInstruction && !isNextContinue) {
           const nextLower = nextInstruction.charAt(0).toLowerCase() + nextInstruction.slice(1);
           lastSpokenInstruction += `. In ${distText}, ${nextLower}.`;
         } else {
           lastSpokenInstruction += `. Continue for ${distText}.`;
         }
      }
      isNewStep = true;
    } else {
      // Still update the instruction property for the UI, but don't speak it
      lastSpokenInstruction = rawInstruction;
    }
  }

  // Calculate real-time distance to the next turn/destination
  const nextStepIdx = currentStepIdx + 1;
  let distToNextTurn = 0;
  let displayInstruction = "Continue";
  
  if (nextStepIdx < routeData.steps.length) {
    const [startIdx] = routeData.steps[nextStepIdx].way_points || [0];
    const nextCoord = coords[startIdx] || coords[coords.length - 1];
    distToNextTurn = calculateDistance(userLat, userLon, nextCoord[1], nextCoord[0]);
    displayInstruction = routeData.steps[nextStepIdx].instruction;
  } else {
    // Last step: distance to destination
    const lastCoord = coords[coords.length - 1] || [0, 0];
    distToNextTurn = calculateDistance(userLat, userLon, lastCoord[1], lastCoord[0]);
    displayInstruction = "Arrive at destination";
  }

  // Arrival detection (using threshold from constants)
  const hasArrived = distToNextTurn < NAVIGATION_CONFIG.arrivalThreshold;
  let finalInstruction = lastSpokenInstruction;

  if (hasArrived && isNewStep) {
    finalInstruction = "You have reached your destination.";
  }

  // Calculate ETA (assume 1.4 m/s => 84 m/min)
  let totalRemainingDist = distToNextTurn;
  for (let s = nextStepIdx; s < routeData.steps.length; s++) {
    totalRemainingDist += routeData.steps[s].distance;
  }
  const etaMinutes = Math.max(1, Math.ceil(totalRemainingDist / 84));

  return {
    stepIndex: currentStepIdx,
    totalSteps: routeData.steps.length,
    instruction: finalInstruction,
    displayInstruction,
    distanceMeters: distToNextTurn,
    etaMinutes,
    routeGeometry: coords,
    isNewStep,
    hasArrived,
  };
};

export const getDirectionInstruction = (bearingDiff, distanceMeters) => {
  const { arrivalThreshold, straightThreshold } = NAVIGATION_CONFIG;

  if (distanceMeters < arrivalThreshold) {
    return "You have arrived at your destination. Tap scan to explore the entrance.";
  }

  const distText = formatDistanceText(distanceMeters);

  if (Math.abs(bearingDiff) <= straightThreshold) {
    return `Walk straight ahead. The destination is ${distText} away.`;
  }
  if (bearingDiff > straightThreshold && bearingDiff <= 70) {
    return `Turn slight right and walk. The destination is ${distText} away.`;
  }
  if (bearingDiff > 70 && bearingDiff <= 135) {
    return `Turn right and walk. The destination is ${distText} away.`;
  }
  if (bearingDiff < -straightThreshold && bearingDiff >= -70) {
    return `Turn slight left and walk. The destination is ${distText} away.`;
  }
  if (bearingDiff < -70 && bearingDiff >= -135) {
    return `Turn left and walk. The destination is ${distText} away.`;
  }

  return `Turn around. The destination is ${distText} behind you.`;
};

// Perpendicular distance from point (px, py) to line segment (ax, ay)-(bx, by)
const pointToSegmentDistance = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return calculateDistance(px, py, ax, ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return calculateDistance(px, py, ax + t * dx, ay + t * dy);
};

// Returns minimum distance in meters from a location to any point on the route polyline
export const getDistanceFromRoute = (location, routeData) => {
  if (!routeData?.geometry?.length) return Infinity;

  const { latitude: lat, longitude: lon } = location;
  const coords = routeData.geometry;
  let minDist = Infinity;

  for (let i = 0; i < coords.length - 1; i++) {
    const dist = pointToSegmentDistance(
      lat, lon,
      coords[i][1], coords[i][0],
      coords[i + 1][1], coords[i + 1][0]
    );
    if (dist < minDist) minDist = dist;
  }
  return minDist;
};

// Announces the next turn when the user is within look-ahead distance
export const speakUpcomingStep = (routeData, userLat, userLon) => {
  if (!routeData?.steps?.length || routeData.provider === 'straight') return null;

  const coords = routeData.geometry;
  if (coords.length < 2) return null;

  // Find current position on route
  let currentStepIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = calculateDistance(userLat, userLon, coords[i][1], coords[i][0]);
    if (d < minDist) {
      minDist = d;
      for (let s = 0; s < routeData.steps.length; s++) {
        const [start, end] = routeData.steps[s].way_points || [0, 0];
        if (i >= start && i <= end) {
          currentStepIdx = s;
          break;
        }
      }
    }
  }

  // Look ahead to next step
  const nextStepIdx = currentStepIdx + 1;
  if (nextStepIdx >= routeData.steps.length) return null;

  const nextStep = routeData.steps[nextStepIdx];
  if (!nextStep) return null;

  // Don't warn "In 30 feet, continue straight" — only warn for actual turns
  const isContinue = nextStep.instruction?.toLowerCase().includes('keep') || nextStep.instruction?.toLowerCase().includes('continue');
  if (isContinue) return null;

  const [startIdx] = nextStep.way_points || [0];
  const nextCoord = coords[startIdx] || coords[coords.length - 1];
  const distToNext = calculateDistance(userLat, userLon, nextCoord[1], nextCoord[0]);

  if (distToNext <= NAVIGATION_CONFIG.lookAheadDistance && nextStepIdx !== lastAnnouncedStepIndex) {
    lastAnnouncedStepIndex = nextStepIdx;
    const distText = formatDistanceText(distToNext);
    const instructionLower = nextStep.instruction.charAt(0).toLowerCase() + nextStep.instruction.slice(1);
    return `In ${distText}, ${instructionLower}.`;
  }

  return null;
};

export const calculateNavigation = (currentLocation, destination, currentHeading = null) => {
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

  // If we have a compass heading, compute relative turn direction
  let bearingDiff;
  if (currentHeading !== null) {
    bearingDiff = bearing - currentHeading;
  } else {
    // Graceful fallback if compass unavailable — absolute bearing
    bearingDiff = bearing; 
  }
  
  // Normalize to -180 to 180 degrees
  bearingDiff = ((bearingDiff + 540) % 360) - 180;

  const instruction = getDirectionInstruction(bearingDiff, distanceMeters);

  // Calculate ETA (assume 1.4 m/s => 84 m/min)
  const etaMinutes = Math.max(1, Math.ceil(distanceMeters / 84));

  return {
    distanceMeters: Math.round(distanceMeters),
    bearing: Math.round(bearing),
    instruction,
    etaMinutes,
    hasArrived: distanceMeters < NAVIGATION_CONFIG.arrivalThreshold,
  };
};

export const getLocationById = (id) => {
  return LOCATIONS.find((loc) => loc.id === id) || null;
};

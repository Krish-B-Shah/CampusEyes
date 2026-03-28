import { LOCATIONS, NAVIGATION_CONFIG } from '../constants/locations';

// Calculate bearing between two points
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const toDeg = rad => (rad * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  let bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

// Calculate distance between two points (Haversine formula)
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const toRad = deg => (deg * Math.PI) / 180;

  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);
  const deltaLat = toRad(lat2 - lat1);
  const deltaLon = toRad(lon2 - lon1);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) *
    Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Get direction instruction based on bearing difference
export function getDirectionInstruction(bearingDiff, distance) {
  const { straightThreshold, nearThreshold } = NAVIGATION_CONFIG;

  if (distance < nearThreshold) {
    return 'You have arrived';
  }

  if (Math.abs(bearingDiff) <= straightThreshold) {
    return 'Walk straight';
  } else if (bearingDiff > 0 && bearingDiff < 180) {
    return 'Turn right';
  } else if (bearingDiff <= 0 && bearingDiff > -180) {
    return 'Turn left';
  } else if (bearingDiff >= 180) {
    return 'Turn left';
  } else {
    return 'Turn right';
  }
}

// Calculate navigation to a destination
export function calculateNavigation(currentLocation, destination) {
  const bearing = calculateBearing(
    currentLocation.latitude,
    currentLocation.longitude,
    destination.latitude,
    destination.longitude
  );

  const distance = calculateDistance(
    currentLocation.latitude,
    currentLocation.longitude,
    destination.latitude,
    destination.longitude
  );

  // Calculate relative bearing (difference between heading and direction to destination)
  let heading = currentLocation.heading || 0;
  let relativeBearing = bearing - heading;

  // Normalize to -180 to 180
  while (relativeBearing > 180) relativeBearing -= 360;
  while (relativeBearing < -180) relativeBearing += 360;

  const instruction = getDirectionInstruction(relativeBearing, distance);
  const hasArrived = distance < NAVIGATION_CONFIG.arrivalThreshold;

  return {
    bearing: Math.round(bearing),
    distance: Math.round(distance),
    instruction,
    hasArrived,
    relativeBearing: Math.round(relativeBearing)
  };
}

export function getLocationById(id) {
  return LOCATIONS.find(loc => loc.id === id);
}

import { LOCATIONS, NAVIGATION_CONFIG } from '../constants/locations';

export const calculateBearing = (lat1, lon1, lat2, lon2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const getDirectionInstruction = (bearingDiff, distance) => {
  const { arrivalThreshold, straightThreshold, nearThreshold } = NAVIGATION_CONFIG;

  if (distance < arrivalThreshold) {
    return "You have arrived at your destination. Tap scan to explore the entrance.";
  }

  const distanceText =
    distance < nearThreshold
      ? `${Math.round(distance)} feet ahead`
      : `about ${Math.round(distance / 10) * 10} feet ahead`;

  if (Math.abs(bearingDiff) <= straightThreshold) {
    return `Walk straight ahead. Destination is ${distanceText}.`;
  }
  if (bearingDiff > straightThreshold && bearingDiff <= 135) {
    return `Turn right and walk. Destination is ${distanceText}.`;
  }
  if (bearingDiff < -straightThreshold && bearingDiff >= -135) {
    return `Turn left and walk. Destination is ${distanceText}.`;
  }

  return `Turn around. Destination is ${distanceText} behind you.`;
};

export const calculateNavigation = (currentLocation, destination) => {
  if (!currentLocation || !destination) return null;

  const distance = calculateDistance(
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

  // Bearing diff requires device compass heading
  // For now use absolute bearing as direction
  const bearingDiff = bearing > 180 ? bearing - 360 : bearing;
  const instruction = getDirectionInstruction(bearingDiff, distance);

  return {
    distance: Math.round(distance),
    bearing: Math.round(bearing),
    instruction,
    hasArrived: distance < NAVIGATION_CONFIG.arrivalThreshold,
  };
};

export const getLocationById = (id) => {
  return LOCATIONS.find((loc) => loc.id === id) || null;
};

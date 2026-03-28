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

// Simple graph builder for LineString walkways in GeoJSON
let walkGraph = null;
let walkNodes = new Map();

function coordKey([lon, lat]) {
  return `${lon.toFixed(6)},${lat.toFixed(6)}`;
}

function ensureNode(coord) {
  const key = coordKey(coord);
  if (!walkNodes.has(key)) {
    walkNodes.set(key, { coord, edges: new Map() });
  }
  return walkNodes.get(key);
}

export function buildWalkGraph(geojson) {
  walkNodes = new Map();
  if (!geojson || !geojson.features) return;

  geojson.features.forEach(feature => {
    if (!feature.geometry) return;
    const type = feature.geometry.type;
    if (type === 'LineString') {
      const coords = feature.geometry.coordinates;
      for (let i = 0; i < coords.length - 1; i++) {
        const a = ensureNode(coords[i]);
        const b = ensureNode(coords[i + 1]);
        const dist = calculateDistance(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
        a.edges.set(coordKey(coords[i + 1]), dist);
        b.edges.set(coordKey(coords[i]), dist);
      }
    } else if (type === 'MultiLineString') {
      feature.geometry.coordinates.forEach(line => {
        for (let i = 0; i < line.length - 1; i++) {
          const a = ensureNode(line[i]);
          const b = ensureNode(line[i + 1]);
          const dist = calculateDistance(line[i][1], line[i][0], line[i + 1][1], line[i + 1][0]);
          a.edges.set(coordKey(line[i + 1]), dist);
          b.edges.set(coordKey(line[i]), dist);
        }
      });
    }
  });

  walkGraph = walkNodes;
}

function getNearestNode(lat, lon) {
  let nearest = null;
  let bestDist = Infinity;
  walkNodes.forEach(node => {
    const d = calculateDistance(lat, lon, node.coord[1], node.coord[0]);
    if (d < bestDist) {
      bestDist = d;
      nearest = node;
    }
  });
  return nearest;
}

function dijkstra(startKey, endKey) {
  const dist = new Map();
  const prev = new Map();
  const q = new Set(walkNodes.keys());

  walkNodes.forEach((_, key) => dist.set(key, Infinity));
  dist.set(startKey, 0);

  while (q.size > 0) {
    let u = null;
    let uDist = Infinity;
    q.forEach(key => {
      const d = dist.get(key);
      if (d < uDist) {
        uDist = d;
        u = key;
      }
    });

    if (u === null) break;
    q.delete(u);
    if (u === endKey) break;

    const node = walkNodes.get(u);
    if (!node) continue;

    node.edges.forEach((weight, v) => {
      if (!q.has(v)) return;
      const alt = dist.get(u) + weight;
      if (alt < dist.get(v)) {
        dist.set(v, alt);
        prev.set(v, u);
      }
    });
  }

  if (!prev.has(endKey) && startKey !== endKey) return null;

  const path = [];
  let u = endKey;
  while (u) {
    path.unshift(u);
    u = prev.get(u);
  }
  return path;
}

export function getRouteSteps(currentLocation, destinationLocation) {
  if (!walkGraph || walkNodes.size === 0) {
    return [{text: 'No map graph loaded', distance: 0}];
  }

  const source = getNearestNode(currentLocation.latitude, currentLocation.longitude);
  const dest = getNearestNode(destinationLocation.latitude, destinationLocation.longitude);
  if (!source || !dest) {
    return [{text: 'No nearby walkable path found', distance: 0}];
  }

  const pathKeys = dijkstra(coordKey(source.coord), coordKey(dest.coord));
  if (!pathKeys) {
    return [{text: 'No walkable path found to destination', distance: 0}];
  }

  const instructions = [];
  let prevBearing = null;

  for (let i = 0; i < pathKeys.length - 1; i++) {
    const from = walkNodes.get(pathKeys[i]);
    const to = walkNodes.get(pathKeys[i + 1]);
    const segmentDistance = calculateDistance(from.coord[1], from.coord[0], to.coord[1], to.coord[0]);
    const bearing = calculateBearing(from.coord[1], from.coord[0], to.coord[1], to.coord[0]);

    if (i === 0) {
      instructions.push({
        text: `Walk ${Math.round(segmentDistance)} meters straight`,
        distance: segmentDistance
      });
    } else {
      const diff = bearing - prevBearing;
      let turn = 'Continue straight';
      const normalized = ((diff + 540) % 360) - 180;
      if (normalized > 45) turn = 'Turn right';
      else if (normalized < -45) turn = 'Turn left';
      instructions.push({
        text: `${turn} and walk ${Math.round(segmentDistance)} meters`,
        distance: segmentDistance
      });
    }

    prevBearing = bearing;
  }

  instructions.push({
    text: `You are now in front of ${destinationLocation.name || 'your destination'}`,
    distance: 0
  });

  return instructions;
}


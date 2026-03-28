// Hardcoded university locations with coordinates
export const LOCATIONS = [
  {
    id: 'library',
    name: 'Library',
    latitude: 37.7749,
    longitude: -122.4194,
    description: 'Main University Library'
  },
  {
    id: 'main-gate',
    name: 'Main Gate',
    latitude: 37.7750,
    longitude: -122.4180,
    description: 'University Main Entrance'
  },
  {
    id: 'student-center',
    name: 'Student Center',
    latitude: 37.7745,
    longitude: -122.4200,
    description: 'Student Center Building'
  }
];

// Objects to detect
export const DETECTION_OBJECTS = ['person', 'chair', 'table', 'door'];

// Speech cooldown in milliseconds
export const SPEECH_COOLDOWN = 3000;

// Navigation settings
export const NAVIGATION_CONFIG = {
  arrivalThreshold: 20, // meters
  straightThreshold: 30, // degrees
  nearThreshold: 50 // meters
};

export const LOCATIONS = [
  {
    id: 'enb',
    name: 'Engineering Building (ENB)',
    latitude: 28.05872,
    longitude: -82.41388,
  },
  {
    id: 'che',
    name: 'Chemical Engineering (CHE)',
    latitude: 28.05940,
    longitude: -82.41420,
  },
  {
    id: 'rec',
    name: 'Recreation Center',
    latitude: 28.06210,
    longitude: -82.41340,
  },
  {
    id: 'library',
    name: 'USF Library (LIB)',
    latitude: 28.06120,
    longitude: -82.41500,
  },
  {
    id: 'msb',
    name: 'Marshall Student Center',
    latitude: 28.06010,
    longitude: -82.41270,
  },
  {
    id: 'cutr',
    name: 'CUTR Building',
    latitude: 28.05910,
    longitude: -82.41350,
  },
  {
    id: 'enc',
    name: 'ENC Building',
    latitude: 28.05950,
    longitude: -82.41310,
  },
];

export const DETECTION_OBJECTS = [
  'person', 'chair', 'table', 'door',
  'bench', 'bicycle', 'car', 'stairs',
];

export const SPEECH_COOLDOWN = 2000;

export const NAVIGATION_CONFIG = {
  arrivalThreshold: 15,
  straightThreshold: 25,
  nearThreshold: 50,
};

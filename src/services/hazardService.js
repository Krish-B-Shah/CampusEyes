import { createClient } from '@supabase/supabase-js';
import { calculateDistance } from './navigationService';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://qwjxtbnhcglmcqiqlrbn.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const HAZARD_RADIUS_METERS = 100;
const HAZARD_DURATION_MINUTES = 30;

// Report a new hazard at current location
export const reportHazard = async (latitude, longitude, description) => {
  try {
    const expiresAt = new Date(
      Date.now() + HAZARD_DURATION_MINUTES * 60 * 1000
    ).toISOString();

    const { data, error } = await supabase
      .from('hazards')
      .insert([{ latitude, longitude, description, expires_at: expiresAt }]);

    if (error) throw error;
    console.log('Hazard reported:', description);
    return data;
  } catch (err) {
    console.error('reportHazard error:', err);
    return null;
  }
};

// Get all active hazards within radius of current location
export const getNearbyHazards = async (latitude, longitude) => {
  try {
    const { data, error } = await supabase
      .from('hazards')
      .select('*')
      .gt('expires_at', new Date().toISOString());

    if (error) throw error;

    // Filter by distance client-side
    const nearby = (data || []).filter((hazard) => {
      const dist = calculateDistance(
        latitude,
        longitude,
        hazard.latitude,
        hazard.longitude
      );
      return dist <= HAZARD_RADIUS_METERS;
    });

    return nearby;
  } catch (err) {
    console.error('getNearbyHazards error:', err);
    return [];
  }
};

// Subscribe to real-time hazard updates near a location
export const subscribeToHazards = (latitude, longitude, onNewHazard) => {
  const subscription = supabase
    .channel('hazards')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'hazards' },
      (payload) => {
        const hazard = payload.new;
        const dist = calculateDistance(
          latitude,
          longitude,
          hazard.latitude,
          hazard.longitude
        );
        if (dist <= HAZARD_RADIUS_METERS) {
          onNewHazard(hazard);
        }
      }
    )
    .subscribe();

  // Return unsubscribe function
  return () => supabase.removeChannel(subscription);
};

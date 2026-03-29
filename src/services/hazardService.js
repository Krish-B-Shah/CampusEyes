import { createClient } from '@supabase/supabase-js';
import { calculateDistance } from './navigationService';

// Env vars ONLY — no hardcoded fallbacks in production
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let supabase = null;

const getClient = () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('Supabase not configured — set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY');
    return null;
  }
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
};

const HAZARD_RADIUS_METERS = 100;
const HAZARD_DURATION_MINUTES = 30;

// ─── Report a hazard ───────────────────────────────────────────────────────

export const reportHazard = async (latitude, longitude, description) => {
  const client = getClient();
  if (!client) return { error: 'Supabase not configured' };

  try {
    const expiresAt = new Date(
      Date.now() + HAZARD_DURATION_MINUTES * 60 * 1000
    ).toISOString();

    const { data, error } = await client
      .from('hazards')
      .insert([{ latitude, longitude, description, expires_at: expiresAt }]);

    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('reportHazard error:', err);
    return { data: null, error: err.message || 'Failed to report hazard' };
  }
};

// ─── Get nearby hazards ────────────────────────────────────────────────────

export const getNearbyHazards = async (latitude, longitude) => {
  const client = getClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('hazards')
      .select('*')
      .gt('expires_at', new Date().toISOString());

    if (error) throw error;

    return (data || []).filter((hazard) => {
      const dist = calculateDistance(latitude, longitude, hazard.latitude, hazard.longitude);
      return dist <= HAZARD_RADIUS_METERS;
    });
  } catch (err) {
    console.error('getNearbyHazards error:', err);
    return [];
  }
};

// ─── Real-time subscription ────────────────────────────────────────────────

export const subscribeToHazards = (latitude, longitude, onNewHazard) => {
  const client = getClient();
  if (!client) return () => {};

  const channel = client
    .channel('hazards-realtime')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'hazards' },
      (payload) => {
        const hazard = payload.new;
        const dist = calculateDistance(
          latitude, longitude, hazard.latitude, hazard.longitude
        );
        if (dist <= HAZARD_RADIUS_METERS) {
          onNewHazard(hazard);
        }
      }
    )
    .subscribe();

  return () => client.removeChannel(channel);
};

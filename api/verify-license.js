// api/verify-license.js
// Vercel serverless function – verifies license key against Supabase

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service_role key (server only)
);

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { license_key } = req.body || {};
  if (!license_key || typeof license_key !== 'string') {
    return res.status(400).json({ valid: false, error: 'Missing license_key' });
  }

  // Lookup in Supabase
  const { data, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('license_key', license_key.trim().toUpperCase())
    .single();

  if (error || !data) {
    return res.status(200).json({ valid: false, error: 'License not found' });
  }

  // Check expiry
  const now = new Date();
  const expiry = new Date(data.expires_at);
  if (expiry < now) {
    return res.status(200).json({ valid: false, error: 'License expired', expired_at: data.expires_at });
  }

  // Check status
  if (data.status !== 'active') {
    return res.status(200).json({ valid: false, error: 'License not active', status: data.status });
  }

  return res.status(200).json({
    valid: true,
    plan: data.plan,          // 'weekly' | 'monthly'
    expires_at: data.expires_at
  });
}

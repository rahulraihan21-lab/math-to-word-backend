// api/verify-license.js
// Verifies license key via LemonSqueezy API — no Supabase needed

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { license_key } = req.body || {};
  if (!license_key) return res.status(400).json({ valid: false, error: 'Missing license_key' });

  try {
    const response = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ license_key: license_key.trim() })
    });

    const data = await response.json();

    if (data.valid) {
      const variantName = data.meta?.variant_name?.toLowerCase() || '';
      const plan = variantName.includes('weekly') ? 'weekly' : 'monthly';
      return res.status(200).json({ valid: true, plan });
    }

    return res.status(200).json({ valid: false, error: data.error || 'Invalid key' });

  } catch (err) {
    return res.status(500).json({ valid: false, error: 'Server error' });
  }
}

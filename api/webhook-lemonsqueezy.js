// api/webhook-lemonsqueezy.js
// Receives payment events from LemonSqueezy and creates/renews licenses

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const WEBHOOK_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

// Plan IDs – fill in from your LemonSqueezy dashboard
const VARIANT_PLAN_MAP = {
  [process.env.LS_WEEKLY_VARIANT_ID]:  { plan: 'weekly',  days: 7  },
  [process.env.LS_MONTHLY_VARIANT_ID]: { plan: 'monthly', days: 31 }
};

function verifySignature(rawBody, signature) {
  const hash = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  return hash === signature;
}

function generateLicenseKey() {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${seg()}${seg()}-${seg()}${seg()}-${seg()}${seg()}-${seg()}${seg()}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = JSON.stringify(req.body);
  const sig = req.headers['x-signature'];

  if (!verifySignature(rawBody, sig)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  const eventName = event?.meta?.event_name;

  // ── subscription_created / order_created ──
  if (eventName === 'subscription_created' || eventName === 'order_created') {
    const variantId = String(event?.data?.attributes?.variant_id || event?.data?.attributes?.first_order_item?.variant_id);
    const email     = event?.data?.attributes?.user_email;
    const planInfo  = VARIANT_PLAN_MAP[variantId] || { plan: 'monthly', days: 31 };

    const licenseKey = generateLicenseKey();
    const expiresAt  = new Date(Date.now() + planInfo.days * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from('licenses').insert({
      license_key:   licenseKey,
      email,
      plan:          planInfo.plan,
      status:        'active',
      expires_at:    expiresAt,
      provider:      'lemonsqueezy',
      provider_id:   String(event?.data?.id),
      created_at:    new Date().toISOString()
    });

    // TODO: send licenseKey to user's email via Resend/SendGrid
    console.log(`License created: ${licenseKey} for ${email}`);
  }

  // ── subscription_cancelled / subscription_expired ──
  if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
    const providerId = String(event?.data?.id);
    await supabase.from('licenses')
      .update({ status: 'cancelled' })
      .eq('provider_id', providerId);
  }

  // ── subscription_renewed ──
  if (eventName === 'subscription_renewed') {
    const providerId = String(event?.data?.attributes?.subscription_id || event?.data?.id);
    const variantId  = String(event?.data?.attributes?.variant_id);
    const planInfo   = VARIANT_PLAN_MAP[variantId] || { plan: 'monthly', days: 31 };
    const newExpiry  = new Date(Date.now() + planInfo.days * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from('licenses')
      .update({ status: 'active', expires_at: newExpiry })
      .eq('provider_id', providerId);
  }

  return res.status(200).json({ received: true });
}

// api/webhook-paddle.js
// Receives payment events from Paddle Classic / Billing

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PADDLE_PUBLIC_KEY = process.env.PADDLE_PUBLIC_KEY; // RSA public key from Paddle dashboard

const PRODUCT_PLAN_MAP = {
  [process.env.PADDLE_WEEKLY_PRODUCT_ID]:  { plan: 'weekly',  days: 7  },
  [process.env.PADDLE_MONTHLY_PRODUCT_ID]: { plan: 'monthly', days: 31 }
};

function generateLicenseKey() {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${seg()}${seg()}-${seg()}${seg()}-${seg()}${seg()}-${seg()}${seg()}`;
}

function verifyPaddleSignature(data, signature) {
  try {
    // Paddle signs by sorting all fields alphabetically and verifying
    const sorted = Object.keys(data)
      .filter(k => k !== 'p_signature')
      .sort()
      .map(k => `${k}=${data[k]}`)
      .join(':');
    const verify = crypto.createVerify('RSA-SHA1');
    verify.update(sorted);
    return verify.verify(PADDLE_PUBLIC_KEY, signature, 'base64');
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body;
  const sig  = body?.p_signature;

  if (!verifyPaddleSignature(body, sig)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const alertName = body?.alert_name;
  const email     = body?.email || body?.customer_email;
  const productId = String(body?.product_id || body?.subscription_plan_id);
  const planInfo  = PRODUCT_PLAN_MAP[productId] || { plan: 'monthly', days: 31 };

  if (alertName === 'payment_succeeded' || alertName === 'subscription_created') {
    const licenseKey = generateLicenseKey();
    const expiresAt  = new Date(Date.now() + planInfo.days * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from('licenses').insert({
      license_key:  licenseKey,
      email,
      plan:         planInfo.plan,
      status:       'active',
      expires_at:   expiresAt,
      provider:     'paddle',
      provider_id:  String(body?.subscription_id || body?.order_id),
      created_at:   new Date().toISOString()
    });

    console.log(`Paddle license created: ${licenseKey} for ${email}`);
  }

  if (alertName === 'subscription_cancelled') {
    await supabase.from('licenses')
      .update({ status: 'cancelled' })
      .eq('provider_id', String(body?.subscription_id));
  }

  if (alertName === 'subscription_payment_succeeded') {
    const newExpiry = new Date(Date.now() + planInfo.days * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('licenses')
      .update({ status: 'active', expires_at: newExpiry })
      .eq('provider_id', String(body?.subscription_id));
  }

  return res.status(200).json({ received: true });
}

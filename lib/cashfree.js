// Cashfree Payment Gateway (API version 2023-08-01).
// Docs: create order -> payment_session_id -> Cashfree JS checkout -> verify by GET order and by webhook.
const crypto = require('crypto');
const cfg = require('./env');
const cf = cfg.cashfree;

const headers = () => ({ 'x-client-id': cf.appId, 'x-client-secret': cf.secret, 'x-api-version': cf.apiVersion, 'Content-Type': 'application/json' });

async function createOrder(order, user) {
  if (cf.mock) return { mode: 'mock', paymentSessionId: 'mock_' + order.number };
  if (!cf.configured) throw new Error('Payments are not configured');
  const body = {
    order_id: order.number,
    order_amount: order.total,
    order_currency: 'INR',
    customer_details: { customer_id: user.id.replace(/[^a-zA-Z0-9_-]/g, '_'), customer_phone: order.address.phone, customer_name: order.address.name, customer_email: user.email || undefined },
    order_meta: { return_url: cfg.siteUrl + '/order/' + order.id, notify_url: cfg.siteUrl + '/api/cashfree/webhook' },
    order_expiry_time: new Date(Date.now() + cfg.pendingMinutes * 60000 + 60000).toISOString()
  };
  const r = await fetch(cf.apiBase + '/pg/orders', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.payment_session_id) { console.error('Cashfree create order failed', r.status, j.message || j.code); throw new Error('Could not start the payment. Please try again.'); }
  return { mode: cf.env, paymentSessionId: j.payment_session_id };
}

// Returns "PAID", "ACTIVE", "EXPIRED", "TERMINATED" ... or null if it could not be checked.
async function fetchStatus(order) {
  if (cf.mock || !cf.configured) return null;
  try {
    const r = await fetch(cf.apiBase + '/pg/orders/' + encodeURIComponent(order.number), { headers: headers() });
    const j = await r.json();
    if (!r.ok) return null;
    if (j.order_status === 'PAID' && Number(j.order_amount) !== Number(order.total)) return 'AMOUNT_MISMATCH';
    return j.order_status;
  } catch (e) { return null; }
}

// signature = base64(HMAC_SHA256(timestamp + rawBody, secret))
function verifyWebhook(rawBody, signature, timestamp) {
  if (!cf.configured || !signature || !timestamp) return false;
  const expected = crypto.createHmac('sha256', cf.secret).update(String(timestamp) + rawBody).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { createOrder, fetchStatus, verifyWebhook, mock: cf.mock, configured: cf.configured, env: cf.env };

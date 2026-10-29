// Minimal .env loader (no dependencies). Real environment variables win over the file.
const fs = require('fs');
const path = require('path');

function load() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
load();

const e = process.env;
// PREVIEW_MODE=1 lets a hosted design preview (e.g. Vercel) behave like development: test payment page, visible OTP.
// Never use it for a real store.
const production = e.NODE_ENV === 'production' && e.PREVIEW_MODE !== '1';
const cfId = (e.CASHFREE_APP_ID || '').trim();
const cfSecret = (e.CASHFREE_SECRET_KEY || '').trim();
const cfEnv = (e.CASHFREE_ENV || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';

module.exports = {
  production,
  port: Number(e.PORT) || 3000,
  siteUrl: (e.SITE_URL || 'http://localhost:' + (Number(e.PORT) || 3000)).replace(/\/+$/, ''),
  dataDir: path.resolve(e.DATA_DIR || path.join(__dirname, '..', 'data')),
  sessionSecret: e.SESSION_SECRET || '',
  trustProxy: e.TRUST_PROXY === '1',
  freeShip: Number(e.FREE_SHIPPING_ABOVE) || 999,
  shipFee: e.SHIPPING_FEE !== undefined && e.SHIPPING_FEE !== '' ? Number(e.SHIPPING_FEE) : 79,
  pendingMinutes: Number(e.PENDING_ORDER_MINUTES) || 30,
  admin: {
    email: (e.ADMIN_EMAIL || 'admin@meltmare.com').trim().toLowerCase(),
    passwordHash: (e.ADMIN_PASSWORD_HASH || '').trim()
  },
  cashfree: {
    appId: cfId,
    secret: cfSecret,
    env: cfEnv,
    configured: Boolean(cfId && cfSecret),
    // With no keys: "mock" payment page in development, payments disabled in production.
    mock: !cfId && !cfSecret && !production,
    apiBase: cfEnv === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com',
    apiVersion: '2023-08-01'
  },
  otp: {
    emailProvider: (e.EMAIL_PROVIDER || (e.RESEND_API_KEY ? 'resend' : 'console')).toLowerCase(),
    smsProvider: (e.SMS_PROVIDER || (e.MSG91_AUTH_KEY ? 'msg91' : 'console')).toLowerCase(),
    resendKey: e.RESEND_API_KEY || '',
    mailFrom: e.MAIL_FROM || 'MELTMARE <onboarding@resend.dev>',
    msg91Key: e.MSG91_AUTH_KEY || '',
    msg91Template: e.MSG91_TEMPLATE_ID || ''
  },
  store: {
    email: (e.STORE_EMAIL || 'hello@meltmare.com').trim(),
    phone: (e.STORE_PHONE || '').trim(),
    address: (e.STORE_ADDRESS || '').trim(),
    hours: (e.STORE_HOURS || 'Mon–Sat, 10 am – 6 pm').trim(),
    policiesReviewed: e.POLICIES_REVIEWED === '1'
  },
  notifyEmail: (e.ADMIN_NOTIFY_EMAIL || '').trim()
};

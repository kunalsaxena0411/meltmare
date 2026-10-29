// Signed cookies, password hashing and in-memory rate limiting. No dependencies.
const crypto = require('crypto');
const cfg = require('./env');

let SECRET = cfg.sessionSecret;
if (!SECRET) {
  if (cfg.production) { console.error('SESSION_SECRET must be set in production.'); process.exit(1); }
  SECRET = crypto.randomBytes(32).toString('hex'); // dev only: sessions reset on restart
}
const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');

function makeToken(payload, ttlSeconds) {
  const body = b64(JSON.stringify(Object.assign({ exp: Math.floor(Date.now() / 1000) + ttlSeconds }, payload)));
  return body + '.' + sign(body);
}
function readToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const good = sign(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch (e) { return null; }
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function cookie(name, value, maxAgeSeconds) {
  return name + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAgeSeconds + (cfg.production ? '; Secure' : '');
}

// scrypt password hashes look like "scrypt$<salt hex>$<hash hex>"
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return 'scrypt$' + salt.toString('hex') + '$' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  if (!stored) return false;
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  const want = Buffer.from(hash, 'hex');
  return test.length === want.length && crypto.timingSafeEqual(test, want);
}

// fixed-window rate limiter
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n += 1;
  return b.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60000).unref();

module.exports = { makeToken, readToken, parseCookies, cookie, hashPassword, checkPassword, limited, safeEqual: (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); } };

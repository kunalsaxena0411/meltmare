// MELTMARE store server: static site + JSON API. Zero dependencies, Node 18+.
// Run: node server.js   (see README.md for configuration)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cfg = require('./lib/env');
const { data, persist, id, nextOrderNumber } = require('./lib/db');
const A = require('./lib/auth');
const cashfree = require('./lib/cashfree');
const notify = require('./lib/notify');

const ROOT = __dirname;
const UPLOADS = path.join(cfg.dataDir, 'uploads');
const SCENTS = ['Woody', 'Floral', 'Fresh', 'Sweet', 'Spiced'];
const PAID_FLOW = ['Paid', 'Packed', 'Shipped', 'Delivered'];
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };

// ---------- admin credentials ----------
let adminHash = cfg.admin.passwordHash;
if (!adminHash && !cfg.production) {
  const pw = process.env.DEV_ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  adminHash = A.hashPassword(pw);
  console.log('\n  Admin sign in (development only):  ' + cfg.admin.email + '  /  ' + pw + '\n  Set ADMIN_PASSWORD_HASH for a permanent password (npm run hash-password).\n');
}
if (!adminHash && cfg.production) console.warn('ADMIN_PASSWORD_HASH is not set: the admin panel is disabled.');
if (cfg.production && !cashfree.configured) console.warn('Cashfree keys are not set: checkout is disabled until CASHFREE_APP_ID and CASHFREE_SECRET_KEY are provided.');

// ---------- small helpers ----------
class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const bad = (m, extra) => new HttpError(400, m, extra);

function send(res, status, body, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {});
  res.writeHead(status, h);
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req, limit) {
  const raw = await readRaw(req, limit || 100 * 1024);
  if (!raw) return {};
  try { const j = JSON.parse(raw); if (j && typeof j === 'object') return j; } catch (e) {}
  throw bad('Invalid request');
}
function clientIp(req) {
  if (cfg.trustProxy) { const f = req.headers['x-forwarded-for']; if (f) return String(f).split(',')[0].trim(); }
  return req.socket.remoteAddress || 'ip';
}
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const int = (v) => (Number.isFinite(Number(v)) && Number.isInteger(Number(v)) ? Number(v) : NaN);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[6-9]\d{9}$/;
const normId = (mode, v) => {
  v = str(v, 120).toLowerCase();
  if (mode === 'email') { if (!EMAIL.test(v)) throw bad('Please enter a valid email address'); return v; }
  if (mode === 'phone') { v = v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''); if (!PHONE.test(v)) throw bad('Please enter a valid 10 digit phone number'); return v; }
  throw bad('Invalid request');
};

// ---------- domain logic ----------
const publicProduct = (p) => p;
const findProduct = (slug) => data.products.find((p) => p.slug === slug);
const delivery = (sub) => (sub === 0 || sub >= cfg.freeShip ? 0 : cfg.shipFee);
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'candle';

function customerOrder(o) {
  const { paymentSessionId, user, stockHeld, ...rest } = o;
  return rest;
}
function holdStock(order) {
  if (order.stockHeld) return;
  order.items.forEach((i) => { const p = findProduct(i.slug); if (p) p.stock = Math.max(0, p.stock - i.qty); });
  order.stockHeld = true;
}
function releaseStock(order) {
  if (!order.stockHeld) return;
  order.items.forEach((i) => { const p = findProduct(i.slug); if (p) p.stock += i.qty; });
  order.stockHeld = false;
}
function markPaid(order) {
  if (order.status !== 'Pending payment' && order.status !== 'Cancelled') return false;
  if (order.status === 'Cancelled' && order.paidAt) return false;
  const late = order.status === 'Cancelled';
  holdStock(order); // no-op when stock is still held
  order.status = 'Paid'; order.paidAt = Date.now();
  if (late) order.note = 'Payment arrived after the order had been cancelled. Check stock before packing.';
  persist();
  notify.orderPaid(order, data.users.find((u) => u.id === order.user));
  return true;
}
function cancelOrder(order) {
  if (order.status === 'Cancelled') return;
  releaseStock(order);
  order.status = 'Cancelled'; order.cancelledAt = Date.now();
  persist();
}
async function refreshOrder(order) {
  if (order.status !== 'Pending payment') return order;
  const st = await cashfree.fetchStatus(order);
  if (st === 'PAID') markPaid(order);
  else if (st === 'AMOUNT_MISMATCH') console.error('Amount mismatch for order ' + order.number);
  return order;
}

// every minute: cancel unpaid orders after the window (checking Cashfree first) and drop stale OTPs
async function sweep(maxAgeMs) {
  const cutoff = Date.now() - (maxAgeMs === undefined ? cfg.pendingMinutes * 60000 : maxAgeMs);
  for (const o of data.orders) {
    if (o.status === 'Pending payment' && o.created < cutoff) {
      await refreshOrder(o);
      if (o.status === 'Pending payment') cancelOrder(o);
    }
  }
  const now = Date.now();
  for (const k of Object.keys(data.otps)) if (data.otps[k].exp < now) delete data.otps[k];
}
setInterval(() => sweep().catch((e) => console.error('sweep failed', e.message)), 60000).unref();

// ---------- auth context ----------
function session(req) {
  const c = A.parseCookies(req);
  const u = A.readToken(c.mm_s);
  const user = u && data.users.find((x) => x.id === u.u);
  const a = A.readToken(c.mm_a);
  return { user: user || null, admin: !!(a && a.a === 1) };
}
const needUser = (s) => { if (!s.user) throw new HttpError(401, 'Please sign in'); return s.user; };
const needAdmin = (s) => { if (!s.admin) throw new HttpError(401, 'Admin sign in required'); };
const profile = (u) => ({ id: u.id, name: u.name, email: u.email || '', phone: u.phone || '', address: u.address || '' });

// ---------- API ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('GET', '/api/products', async () => ({
  products: data.products.filter((p) => p.active).map(publicProduct),
  config: { freeShip: cfg.freeShip, shipFee: cfg.shipFee, store: cfg.store, payments: cashfree.mock ? 'mock' : cashfree.configured ? cashfree.env : 'off' }
}));

// --- customer auth (email or phone + OTP)
route('POST', '/api/auth/request', async (ctx) => {
  const b = await readJson(ctx.req);
  const mode = b.mode === 'phone' ? 'phone' : 'email', ident = normId(mode, b.id);
  if (A.limited('otp-ip:' + ctx.ip, 15, 15 * 60000) || A.limited('otp-id:' + ident, 5, 15 * 60000)) throw new HttpError(429, 'Too many attempts. Please try again in a few minutes.');
  const key = mode + ':' + ident, prev = data.otps[key];
  if (prev && Date.now() - prev.sentAt < 30000) throw new HttpError(429, 'Please wait a few seconds before asking for a new code.');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  data.otps[key] = { hash: crypto.createHash('sha256').update(code + key).digest('hex'), exp: Date.now() + 10 * 60000, tries: 0, sentAt: Date.now() };
  try { await notify.sendOtp(mode, ident, code); } catch (e) { delete data.otps[key]; console.error('OTP send failed:', e.message); throw new HttpError(502, 'We could not send the code. Please try again.'); }
  persist();
  const out = { ok: true };
  if (!cfg.production && process.env.DEV_SHOW_OTP === '1') out.devOtp = code;
  return out;
});
route('POST', '/api/auth/verify', async (ctx) => {
  const b = await readJson(ctx.req);
  const mode = b.mode === 'phone' ? 'phone' : 'email', ident = normId(mode, b.id), key = mode + ':' + ident;
  if (A.limited('verify-ip:' + ctx.ip, 30, 15 * 60000)) throw new HttpError(429, 'Too many attempts. Please try again later.');
  const rec = data.otps[key];
  if (!rec || rec.exp < Date.now()) throw bad('That code has expired. Please ask for a new one.');
  if (rec.tries >= 5) { delete data.otps[key]; throw bad('Too many wrong attempts. Please ask for a new code.'); }
  const given = crypto.createHash('sha256').update(str(b.code, 6) + key).digest('hex');
  if (!A.safeEqual(given, rec.hash)) { rec.tries += 1; persist(); throw bad('That code is not right. Please try again.'); }
  let user = data.users.find((u) => (mode === 'email' ? u.email === ident : u.phone === ident));
  if (!user) {
    const name = str(b.name, 80);
    if (!name) throw new HttpError(422, 'Please tell us your name', { needName: true }); // code is kept so the user can retry with a name
    user = { id: id('u_'), name, email: mode === 'email' ? ident : '', phone: mode === 'phone' ? ident : '', address: '', created: Date.now() };
    data.users.push(user);
  }
  delete data.otps[key]; persist();
  ctx.setCookie(A.cookie('mm_s', A.makeToken({ u: user.id }, 30 * 86400), 30 * 86400));
  return { user: profile(user) };
});
route('GET', '/api/auth/me', async (ctx) => ({ user: ctx.s.user ? profile(ctx.s.user) : null }));
route('POST', '/api/auth/logout', async (ctx) => { ctx.setCookie(A.cookie('mm_s', '', 0)); return { ok: true }; });
route('PATCH', '/api/me', async (ctx) => {
  const u = needUser(ctx.s), b = await readJson(ctx.req);
  const name = str(b.name, 80), address = str(b.address, 300);
  let email = str(b.email, 120).toLowerCase(), phone = str(b.phone, 20);
  if (email && !EMAIL.test(email)) throw bad('Please enter a valid email address');
  if (phone) phone = normId('phone', phone);
  if (email && data.users.some((x) => x.id !== u.id && x.email === email)) throw bad('That email is already used by another account');
  if (phone && data.users.some((x) => x.id !== u.id && x.phone === phone)) throw bad('That phone number is already used by another account');
  if (!name) throw bad('Please fill in your name');
  // the identifier you signed in with cannot be removed
  if (u.email && !email) email = u.email;
  if (u.phone && !phone) phone = u.phone;
  Object.assign(u, { name, email, phone, address }); persist();
  return { user: profile(u) };
});

// --- orders and payment
route('POST', '/api/orders', async (ctx) => {
  const u = needUser(ctx.s), b = await readJson(ctx.req);
  if (A.limited('order:' + u.id, 12, 3600000)) throw new HttpError(429, 'Too many orders in a short time. Please try again later.');
  if (!cashfree.mock && !cashfree.configured) throw new HttpError(503, 'Online payments are not available right now.');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 20) throw bad('Your cart is empty');
  const merged = new Map();
  for (const it of b.items) {
    const qty = int(it.qty), p = findProduct(str(it.slug, 80));
    if (!p || !p.active) throw bad('One of the items is no longer available');
    if (!(qty >= 1 && qty <= 10)) throw bad('Please choose a quantity between 1 and 10');
    merged.set(p.slug, (merged.get(p.slug) || 0) + qty);
  }
  const items = [];
  for (const [slug, qty] of merged) {
    const p = findProduct(slug);
    if (p.stock < qty) throw bad(p.stock <= 0 ? p.name + ' just sold out' : 'Only ' + p.stock + ' of ' + p.name + ' left', { slug });
    items.push({ slug, name: p.name, price: p.price, qty });
  }
  const a = b.address || {};
  const address = { name: str(a.name, 80), phone: '', line: str(a.line, 200), city: str(a.city, 60), state: str(a.state, 60), pin: str(a.pin, 6) };
  if (!address.name || !address.line || !address.city) throw bad('Please fill in all delivery details');
  address.phone = normId('phone', a.phone);
  if (!/^\d{6}$/.test(address.pin)) throw bad('Please enter a valid 6 digit pincode');
  const subtotal = items.reduce((t, i) => t + i.price * i.qty, 0), ship = delivery(subtotal);
  const order = { id: id('o_'), number: nextOrderNumber(), user: u.id, created: Date.now(), status: 'Pending payment', subtotal, delivery: ship, total: subtotal + ship, address, items, stockHeld: false, tracking: '' };
  holdStock(order); data.orders.push(order);
  try {
    const pay = await cashfree.createOrder(order, u);
    order.paymentSessionId = pay.paymentSessionId; order.paymentMode = pay.mode;
    if (!u.address) u.address = address.line + ', ' + address.city + ' ' + address.pin;
    if (!u.phone) { const taken = data.users.some((x) => x.phone === address.phone); if (!taken) u.phone = address.phone; }
    persist();
    return { order: customerOrder(order), payment: pay };
  } catch (e) {
    cancelOrder(order); data.orders.splice(data.orders.indexOf(order), 1); persist();
    throw new HttpError(502, e.message || 'Could not start the payment');
  }
});
route('GET', '/api/orders', async (ctx) => {
  const u = needUser(ctx.s);
  const mine = data.orders.filter((o) => o.user === u.id).sort((a, b) => b.created - a.created);
  await Promise.all(mine.filter((o) => o.status === 'Pending payment').map(refreshOrder));
  return { orders: mine.map(customerOrder) };
});
const ownOrder = (ctx) => {
  const u = needUser(ctx.s), o = data.orders.find((x) => x.id === ctx.params.id && x.user === u.id);
  if (!o) throw new HttpError(404, 'Order not found');
  return o;
};
route('GET', '/api/orders/:id', async (ctx) => { const o = ownOrder(ctx); await refreshOrder(o); return { order: customerOrder(o) }; });
route('POST', '/api/orders/:id/pay', async (ctx) => {
  const o = ownOrder(ctx);
  await refreshOrder(o);
  if (o.status !== 'Pending payment') throw bad('This order is no longer waiting for payment');
  return { order: customerOrder(o), payment: { mode: o.paymentMode, paymentSessionId: o.paymentSessionId } };
});

route('POST', '/api/cashfree/webhook', async (ctx) => {
  const raw = await readRaw(ctx.req, 200 * 1024);
  if (!cashfree.verifyWebhook(raw, ctx.req.headers['x-webhook-signature'], ctx.req.headers['x-webhook-timestamp'])) throw new HttpError(401, 'Bad signature');
  let evt; try { evt = JSON.parse(raw); } catch (e) { return { ok: true }; }
  if (evt.type === 'PAYMENT_SUCCESS_WEBHOOK' && evt.data && evt.data.order) {
    const o = data.orders.find((x) => x.number === evt.data.order.order_id);
    const ok = o && Number(evt.data.order.order_amount) === o.total && (!evt.data.payment || evt.data.payment.payment_status === 'SUCCESS');
    if (ok) markPaid(o); else console.error('Webhook ignored (unknown order or amount mismatch):', evt.data.order.order_id);
  }
  return { ok: true };
});

// development payment page, only when no Cashfree keys are set and NODE_ENV is not production
route('POST', '/api/mock/pay', async (ctx) => {
  if (!cashfree.mock) throw new HttpError(404, 'Not found');
  const b = await readJson(ctx.req), o = data.orders.find((x) => x.id === str(b.id, 40));
  if (!o) throw new HttpError(404, 'Order not found');
  if (b.result === 'success') markPaid(o);
  return { ok: true, status: o.status };
});

// --- contact and newsletter
route('POST', '/api/contact', async (ctx) => {
  const b = await readJson(ctx.req);
  if (A.limited('contact:' + ctx.ip, 5, 3600000)) throw new HttpError(429, 'Too many messages. Please try again later.');
  const m = { id: id('m_'), name: str(b.name, 80), email: str(b.email, 120).toLowerCase(), phone: str(b.phone, 20), message: str(b.message, 2000), created: Date.now() };
  if (!m.name || !EMAIL.test(m.email) || !m.message) throw bad('Please fill in your name, a valid email and a message');
  data.messages.push(m); persist(); return { ok: true };
});
route('POST', '/api/subscribe', async (ctx) => {
  const b = await readJson(ctx.req), email = str(b.email, 120).toLowerCase();
  if (A.limited('sub:' + ctx.ip, 10, 3600000)) throw new HttpError(429, 'Too many requests');
  if (!EMAIL.test(email)) throw bad('Please enter a valid email address');
  if (!data.subscribers.some((s) => s.email === email)) { data.subscribers.push({ email, created: Date.now() }); persist(); }
  return { ok: true };
});

// --- admin
route('POST', '/api/admin/login', async (ctx) => {
  const b = await readJson(ctx.req);
  if (A.limited('admin:' + ctx.ip, 8, 15 * 60000)) throw new HttpError(429, 'Too many attempts. Please try again in a few minutes.');
  if (!adminHash) throw new HttpError(503, 'Admin sign in is not set up yet');
  const ok = str(b.email, 120).toLowerCase() === cfg.admin.email && A.checkPassword(String(b.password || ''), adminHash);
  if (!ok) throw new HttpError(401, 'Those details are not right. Please try again.');
  ctx.setCookie(A.cookie('mm_a', A.makeToken({ a: 1 }, 8 * 3600), 8 * 3600));
  return { ok: true };
});
route('POST', '/api/admin/logout', async (ctx) => { ctx.setCookie(A.cookie('mm_a', '', 0)); return { ok: true }; });
route('GET', '/api/admin/me', async (ctx) => ({ admin: ctx.s.admin }));
route('GET', '/api/admin/summary', async (ctx) => {
  needAdmin(ctx.s);
  const day = new Date().toDateString(), live = data.orders.filter((o) => PAID_FLOW.includes(o.status));
  const today = live.filter((o) => new Date(o.paidAt || o.created).toDateString() === day);
  return { ordersToday: today.length, revenueToday: today.reduce((t, o) => t + o.total, 0), toPack: data.orders.filter((o) => o.status === 'Paid').length, lowStock: data.products.filter((p) => p.active && p.stock <= 5).length, revenueTotal: live.reduce((t, o) => t + o.total, 0), customers: data.users.length };
});
route('GET', '/api/admin/products', async (ctx) => { needAdmin(ctx.s); return { products: data.products }; });
function applyProduct(p, b, isNew) {
  const set = (k, v) => { p[k] = v; };
  if (isNew || b.name !== undefined) { const v = str(b.name, 80); if (!v) throw bad('Product name is required'); set('name', v); }
  if (isNew || b.scent !== undefined) { if (!SCENTS.includes(b.scent)) throw bad('Choose a scent family'); set('scent', b.scent); }
  if (isNew || b.price !== undefined) { const v = int(b.price); if (!(v >= 1 && v <= 100000)) throw bad('Enter a valid price'); set('price', v); }
  if (isNew || b.stock !== undefined) { const v = int(b.stock); if (!(v >= 0 && v <= 100000)) throw bad('Enter a valid stock number'); set('stock', v); }
  if (isNew || b.desc !== undefined) set('desc', str(b.desc, 600));
  if (isNew || b.notes !== undefined) set('notes', (Array.isArray(b.notes) ? b.notes : String(b.notes || '').split(',')).map((n) => str(n, 40)).filter(Boolean).slice(0, 4));
  if (isNew || b.tag !== undefined) set('tag', str(b.tag, 24));
  if (b.image !== undefined) { const v = str(b.image, 200); if (v && !/^\/(media|assets\/img)\/[\w./-]+$/.test(v)) throw bad('Invalid image'); set('image', v); }
  if (b.featured !== undefined) set('featured', !!b.featured);
  if (b.active !== undefined) set('active', !!b.active);
}
route('POST', '/api/admin/products', async (ctx) => {
  needAdmin(ctx.s);
  const b = await readJson(ctx.req), p = { featured: false, active: true, createdAt: Date.now() };
  applyProduct(p, b, true);
  let slug = slugify(p.name), n = 2; while (findProduct(slug)) slug = slugify(p.name) + '-' + n++;
  p.slug = slug; data.products.push(p); persist(); return { product: p };
});
route('PATCH', '/api/admin/products/:slug', async (ctx) => {
  needAdmin(ctx.s);
  const p = findProduct(ctx.params.slug); if (!p) throw new HttpError(404, 'Product not found');
  applyProduct(p, await readJson(ctx.req), false); persist(); return { product: p };
});
route('POST', '/api/admin/upload', async (ctx) => {
  needAdmin(ctx.s);
  const b = await readJson(ctx.req, 8 * 1024 * 1024), m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ''));
  if (!m) throw bad('Please upload a JPG, PNG or WebP image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) throw bad('The image is larger than 5 MB');
  const magic = buf.slice(0, 12).toString('latin1'), okMagic = (m[1] === 'jpeg' && buf[0] === 0xff && buf[1] === 0xd8) || (m[1] === 'png' && magic.startsWith('\x89PNG')) || (m[1] === 'webp' && magic.startsWith('RIFF') && magic.slice(8, 12) === 'WEBP');
  if (!okMagic) throw bad('That file is not a valid image');
  const name = crypto.randomBytes(8).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return { url: '/media/' + name };
});
route('GET', '/api/admin/orders', async (ctx) => {
  needAdmin(ctx.s);
  const orders = data.orders.slice().sort((a, b) => b.created - a.created).map((o) => {
    const u = data.users.find((x) => x.id === o.user) || {}, { paymentSessionId, ...rest } = o;
    return Object.assign({}, rest, { customer: { email: u.email || '', phone: u.phone || '' } });
  });
  return { orders };
});
route('PATCH', '/api/admin/orders/:id', async (ctx) => {
  needAdmin(ctx.s);
  const o = data.orders.find((x) => x.id === ctx.params.id); if (!o) throw new HttpError(404, 'Order not found');
  const b = await readJson(ctx.req);
  if (b.tracking !== undefined) o.tracking = str(b.tracking, 200);
  if (b.status !== undefined && b.status !== o.status) {
    if (b.status === 'Cancelled') cancelOrder(o);
    else if (PAID_FLOW.includes(b.status) && PAID_FLOW.includes(o.status)) o.status = b.status;
    else throw bad('That status change is not allowed. Orders become Paid only after a successful payment.');
  }
  persist(); return { order: o };
});
route('GET', '/api/admin/messages', async (ctx) => { needAdmin(ctx.s); return { messages: data.messages.slice().sort((a, b) => b.created - a.created) }; });

// ---------- http plumbing ----------
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (cfg.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

async function handleApi(req, res, pathname) {
  const method = req.method;
  const isWebhook = pathname === '/api/cashfree/webhook';
  if (method !== 'GET' && !isWebhook) {
    // CSRF guard: JSON only, and same origin when the browser sends an Origin header
    if (!/^application\/json/i.test(req.headers['content-type'] || '') && Number(req.headers['content-length'] || 0) > 0) throw new HttpError(415, 'Unsupported content type');
    const origin = req.headers.origin;
    if (origin) { let host = ''; try { host = new URL(origin).host; } catch (e) {} if (host !== req.headers.host) throw new HttpError(403, 'Forbidden'); }
  }
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname); if (!m) continue;
    const cookies = [];
    const ctx = { req, ip: clientIp(req), s: session(req), params: m.groups || {}, setCookie: (c) => cookies.push(c) };
    const out = await r.fn(ctx);
    return send(res, 200, out, cookies.length ? { 'Set-Cookie': cookies } : {});
  }
  throw new HttpError(404, 'Not found');
}

function mockPayPage(order) {
  return '<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Test payment</title><body style="font-family:system-ui;max-width:420px;margin:60px auto;padding:0 16px;text-align:center"><h2>Test payment page</h2><p>Order <b>' + order.number + '</b> for <b>₹' + order.total + '</b></p><p style="color:#a00">Development only. Real payments use Cashfree once keys are set.</p><button id=ok style="padding:12px 20px;font-size:16px">Simulate successful payment</button> <button id=no style="padding:12px 20px;font-size:16px">Simulate failure</button><script>function go(r){fetch("/api/mock/pay",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:"' + order.id + '",result:r})}).then(function(){location.href="/order/' + order.id + '"})}ok.onclick=function(){go("success")};no.onclick=function(){go("fail")}</script>';
}

const STATIC_FILES = { '/styles.css': 'styles.css', '/app.js': 'app.js' };
function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}
const inside = (base, rel) => { const f = path.join(base, rel); return f.startsWith(base + path.sep) ? f : null; };

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  let pathname;
  try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch (e) { return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' }); }
  if (pathname.includes('\0')) return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' });
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (STATIC_FILES[pathname]) return serveFile(res, path.join(ROOT, STATIC_FILES[pathname]), 'no-cache');
    if (pathname.startsWith('/assets/')) { const f = inside(path.join(ROOT, 'assets'), pathname.slice(8)); return f ? serveFile(res, f, 'public, max-age=604800') : send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }); }
    if (pathname.startsWith('/media/')) { const f = inside(UPLOADS, pathname.slice(7)); return f ? serveFile(res, f, 'public, max-age=604800') : send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }); }
    let m;
    if (cashfree.mock && (m = /^\/mock-pay\/([\w-]+)$/.exec(pathname))) {
      const o = data.orders.find((x) => x.id === m[1]);
      return o ? send(res, 200, mockPayPage(o), { 'Content-Type': 'text/html; charset=utf-8' }) : send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    }
    if (path.extname(pathname)) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    return serveFile(res, path.join(ROOT, 'index.html'), 'no-cache'); // single page app fallback
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, Object.assign({ error: e.message }, e.extra || {}));
    console.error(e);
    return send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
});

if (require.main === module) {
  server.listen(cfg.port, () => console.log('MELTMARE running on ' + cfg.siteUrl + '  (payments: ' + (cashfree.mock ? 'MOCK test page' : cashfree.configured ? 'Cashfree ' + cashfree.env : 'OFF') + ')'));
}
module.exports = { server, sweep };

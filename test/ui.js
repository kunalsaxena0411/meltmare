// Browser-level test: loads the real site in jsdom against the real server (mock payment mode).
// Needs jsdom once:  npm install --no-save jsdom     then:  node test/ui.js
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { boot, check, done } = require('./helpers');

const errors = [];
(async () => {
  const { base } = await boot({ CASHFREE_APP_ID: '', CASHFREE_SECRET_KEY: '' });
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/<script src[^>]*><\/script>/g, '').replace(/<link[^>]*>/g, '');
  const js = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function browser() {
    const jar = {};
    const jfetch = async (url, opts) => {
      opts = opts || {}; const headers = Object.assign({}, opts.headers || {});
      const c = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '); if (c) headers.Cookie = c;
      const r = await fetch(new URL(url, base).href, { method: opts.method, headers, body: opts.body });
      (r.headers.getSetCookie() || []).forEach((sc) => { const [kv, ...a] = sc.split(';'); const i = kv.indexOf('='); const n = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1)); if (/Max-Age=0/i.test(a.join(';')) || !v) delete jar[n]; else jar[n] = v; });
      return r;
    };
    const open = async (p) => {
      const vc = new VirtualConsole();
      vc.on('jsdomError', (e) => errors.push(p + ': ' + (e.detail || e.message)));
      const dom = new JSDOM(html, { url: base + p, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
      const w = dom.window; w.scrollTo = () => {}; w.fetch = jfetch; w.confirm = () => true; w.__navs = [];
      w.eval(js); w.__mm.navigate = (u) => w.__navs.push(u);
      await w.__mm.ready; return w;
    };
    return { open, jar, jfetch };
  }
  const text = (w) => w.document.body.textContent.replace(/\s+/g, ' ');
  const until = async (w, fn, label) => { for (let i = 0; i < 300; i++) { try { if (fn()) return true; } catch (e) {} await sleep(10); } check('timeout waiting for ' + label, false); return false; };
  const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const submit = (w, f) => f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const change = (w, el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
  const nav = async (w, p) => { w.history.pushState(null, '', p); w.dispatchEvent(new w.PopStateEvent('popstate')); await sleep(60); };

  console.log('Pages');
  const routes = {
    '/': ['Warm light', 'Our favourites', 'Find your scent', 'Loved by our customers', 'Join the MELTMARE circle', 'Cedar Dusk'],
    '/shop': ['Shop all', 'Showing 10 of 10', 'Sold out', 'Only 3 left'],
    '/shop?scent=Woody': ['Cedar Dusk', 'Fig and Sandalwood', 'Showing 2 of 10'],
    '/product/cedar-dusk': ['Cedar Dusk', 'Cedarwood', '599', 'In stock, ready to ship', 'Add to cart', 'You may also like'],
    '/product/rose-petal': ['Sold out for now'],
    '/story': ['Our story'], '/contact': ['Say hello', 'hello@meltmare.com', 'Send message'], '/faq': ['Frequently asked questions'], '/candle-care': ['Burn it right'],
    '/policies/shipping': ['Shipping policy'], '/policies/privacy': ['Cashfree'], '/cart': ['Your cart is empty'],
    '/login': ['Welcome to MELTMARE', 'Send OTP'], '/nope': ['This page has gone missing'], '/admin': ['Sign in to manage the store']
  };
  for (const [p, needles] of Object.entries(routes)) {
    const w = await browser().open(p), t = text(w).toLowerCase();
    const missing = needles.filter((n) => !t.includes(n.toLowerCase()));
    check(p, missing.length === 0, 'missing: ' + missing.join(' | '));
  }
  {
    const w = await browser().open('/contact');
    check('no placeholder brackets or fake phone on contact page', !/\[|90000/.test(text(w)), text(w).match(/\[[^\]]*\]|90000[ 0-9]*/));
    const p = await browser().open('/product/cedar-dusk');
    check('no placeholder brackets on product page', !/\[grams\]|\[hours\]/.test(text(p)));
    const h = await browser().open('/');
    check('home: 8 favourites, 5 scent tiles', h.document.querySelectorAll('.card').length === 8 && h.document.querySelectorAll('.tile').length === 5);
    check('admin page hides credentials', !/admin123|test-admin-pass/.test(text(await browser().open('/admin'))));
    check('product images point at real files', [...h.document.querySelectorAll('.card img')].every((i) => /^\/assets\/img\/[\w-]+\.jpg$/.test(i.getAttribute('src'))));
  }

  console.log('Cart');
  {
    const w = await browser().open('/product/cedar-dusk');
    click(w, w.document.querySelector('#qp')); click(w, w.document.querySelector('#addBtn'));
    const cart = JSON.parse(w.localStorage.getItem('mm_cart'));
    check('adds 2 Cedar Dusk', cart[0].slug === 'cedar-dusk' && cart[0].qty === 2);
    check('badge shows 2', w.document.querySelector('#cartCount').textContent === '2');
    check('free delivery unlocked at 1198', /unlocked free delivery/.test(w.document.querySelector('#cartDrawer').textContent));
    click(w, w.document.querySelector('[data-qty="cedar-dusk"][data-d="1"]'));
    check('plus raises qty to 3', JSON.parse(w.localStorage.getItem('mm_cart'))[0].qty === 3);
    click(w, w.document.querySelector('[data-remove="cedar-dusk"]'));
    check('remove empties cart', JSON.parse(w.localStorage.getItem('mm_cart')).length === 0);
  }
  {
    const w = await browser().open('/shop');
    check('sold out item has no add button', !w.document.querySelector('[data-add="rose-petal"]'));
    click(w, w.document.querySelector('[data-add="lavender-haze"]'));
    for (let i = 0; i < 3; i++) click(w, w.document.querySelector('[data-qty="lavender-haze"][data-d="1"]'));
    check('quantity capped at stock of 3', JSON.parse(w.localStorage.getItem('mm_cart'))[0].qty === 3);
    const v = await browser().open('/product/vanilla-linen'); click(v, v.document.querySelector('#addBtn'));
    check('nudge under 999', /₹450 away from free delivery/.test(v.document.querySelector('#cartDrawer').textContent));
  }

  console.log('Contact and newsletter');
  {
    const w = await browser().open('/contact'), f = w.document.querySelector('#contactForm');
    f.querySelector('[name=name]').value = 'Neha'; f.querySelector('[name=email]').value = 'neha@example.com'; f.querySelector('[name=message]').value = 'Do you ship to Goa?';
    submit(w, f); await until(w, () => /get back to you/.test(w.document.querySelector('#toast').textContent), 'contact toast');
    check('contact form sent to server', true);
  }

  console.log('Login, checkout, payment');
  const shopper = browser();
  const w = await shopper.open('/login?next=/checkout');
  const d = w.document;
  w.localStorage.setItem('mm_cart', JSON.stringify([{ slug: 'cedar-dusk', qty: 2 }]));
  d.querySelector('#idInput').value = 'asha@example.com'; submit(w, d.querySelector('#loginForm'));
  await until(w, () => d.querySelector('#otpBox').style.display !== 'none', 'otp box');
  const code = (d.querySelector('#otpNote').textContent.match(/code is (\d{6})/) || [])[1];
  check('otp step shows (test mode code visible)', !!code);
  [...d.querySelectorAll('.otp input')].forEach((i, k) => (i.value = code[k]));
  submit(w, d.querySelector('#loginForm'));
  await until(w, () => d.querySelector('#nameField').style.display !== 'none', 'name field');
  check('new account asked for name', /Tell us your name/.test(d.querySelector('#loginErr').textContent));
  d.querySelector('#nameInput').value = 'Asha Rao'; submit(w, d.querySelector('#loginForm'));
  await until(w, () => w.location.pathname === '/checkout' && d.querySelector('#checkoutForm'), 'checkout page');
  check('redirected to checkout, Asha signed in', w.location.pathname === '/checkout' && shopper.jar.mm_s);
  check('pay button shows total, free delivery', /Pay ₹1,198 securely/.test(text(w)) && /Free/.test(text(w)));
  let f = d.querySelector('#checkoutForm'); const set = (n, v) => { f.querySelector('[name=' + n + ']').value = v; };
  set('name', 'Asha Rao'); set('phone', '9876543210'); set('line', '12 MG Road'); set('city', 'Bengaluru'); set('pin', '560001');
  submit(w, f);
  await until(w, () => w.__navs.length, 'payment redirect');
  const payUrl = w.__navs[0];
  check('sent to payment page for the new order', /^\/mock-pay\/o_[0-9a-f]+$/.test(payUrl), payUrl);
  const orderId = payUrl.split('/').pop();
  await nav(w, '/order/' + orderId);
  await until(w, () => /WAITING FOR PAYMENT/i.test(text(w)), 'waiting page');
  check('unpaid order shows waiting page with pay button', !!d.querySelector('[data-pay]'));
  await shopper.jfetch('/api/mock/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: orderId, result: 'success' }) });
  await nav(w, '/order/' + orderId);
  await until(w, () => /Thank you, Asha/.test(text(w)), 'confirmation');
  check('confirmation page after payment', /MM000001/.test(text(w)));
  check('cart cleared after paid', JSON.parse(w.localStorage.getItem('mm_cart')).length === 0);
  await nav(w, '/account'); await until(w, () => /MM000001/.test(text(w)), 'account orders');
  check('account lists order as confirmed', /Order confirmed/.test(text(w)) && /₹1,198/.test(text(w)));
  await nav(w, '/account?tab=profile'); await until(w, () => d.querySelector('#profileForm'), 'profile');
  check('profile prefilled from checkout', d.querySelector('[name=phone]').value === '9876543210' && /12 MG Road/.test(d.querySelector('[name=address]').value));
  click(w, d.querySelector('#logout')); await until(w, () => w.location.pathname === '/' && !shopper.jar.mm_s, 'logout');
  check('logout clears session', !shopper.jar.mm_s);
  await nav(w, '/account'); await until(w, () => w.location.pathname === '/login', 'redirect');
  check('account needs login', w.location.pathname === '/login');

  console.log('Admin');
  const adm = browser(), a = await adm.open('/admin'), ad = a.document;
  let af = ad.querySelector('#adminLogin'); af.querySelector('[name=email]').value = 'admin@meltmare.com'; af.querySelector('[name=password]').value = 'nope';
  submit(a, af); await until(a, () => /not right/.test(text(a)), 'wrong pw message');
  check('wrong password rejected', /not right/.test(text(a)));
  af = ad.querySelector('#adminLogin'); af.querySelector('[name=password]').value = 'test-admin-pass'; submit(a, af);
  await until(a, () => /Orders today/.test(text(a)), 'dashboard');
  check('dashboard shows live numbers', /Orders today/.test(text(a)) && /₹1,198/.test(text(a)));
  await nav(a, '/admin?tab=products'); await until(a, () => ad.querySelector('[data-pf=stock]'), 'products tab');
  const stock = ad.querySelector('[data-pf="stock"][data-slug="rose-petal"]'); stock.value = '9'; change(a, stock);
  await sleep(150);
  check('stock edit saved on server', (await (await adm.jfetch('/api/products')).json()).products.find((p) => p.slug === 'rose-petal').stock === 9);
  const ap = ad.querySelector('#addProduct'); ap.querySelector('[name=name]').value = 'Chai Latte'; ap.querySelector('[name=price]').value = '499'; ap.querySelector('[name=stock]').value = '6'; ap.querySelector('[name=notes]').value = 'Cardamom, Tea';
  submit(a, ap); await until(a, () => /Chai Latte/.test(text(a)), 'new product row');
  check('product added from admin', /Chai Latte/.test(text(a)));
  await nav(a, '/admin?tab=orders'); await until(a, () => ad.querySelector('[data-status]'), 'orders tab');
  check('orders tab shows customer and items', /Asha Rao/.test(text(a)) && /asha@example.com/.test(text(a)) && /Cedar Dusk × 2/.test(text(a)));
  const sel = ad.querySelector('[data-status]'); sel.value = 'Shipped'; change(a, sel);
  const tr = ad.querySelector('[data-track]'); tr.value = 'Delhivery 12345'; change(a, tr);
  await sleep(200);
  const ord = (await (await adm.jfetch('/api/admin/orders')).json()).orders[0];
  check('status and tracking saved', ord.status === 'Shipped' && ord.tracking === 'Delhivery 12345');
  await nav(a, '/admin?tab=messages'); await until(a, () => /Goa/.test(text(a)), 'messages');
  check('contact message visible to admin', /Do you ship to Goa/.test(text(a)));
  click(a, ad.querySelector('#adminOut')); await until(a, () => /Sign in to manage/.test(text(a)), 'admin logout');
  check('admin sign out', true);

  console.log('Customer sees shipping update');
  const c2 = await shopper.open('/login');
  // sign in again as Asha
  c2.document.querySelector('#idInput').value = 'asha@example.com'; submit(c2, c2.document.querySelector('#loginForm'));
  await until(c2, () => c2.document.querySelector('#otpBox').style.display !== 'none', 'otp');
  const code2 = c2.document.querySelector('#otpNote').textContent.match(/code is (\d{6})/)[1];
  [...c2.document.querySelectorAll('.otp input')].forEach((i, k) => (i.value = code2[k])); submit(c2, c2.document.querySelector('#loginForm'));
  await until(c2, () => c2.location.pathname === '/', 'back home'); await nav(c2, '/account'); await until(c2, () => /On its way/.test(text(c2)), 'shipped status');
  check('returning user signs in without a name prompt; sees On its way + tracking', /On its way/.test(text(c2)) && /Delhivery 12345/.test(text(c2)));

  console.log(errors.length ? '\nJS errors:\n' + errors.join('\n') : '\nNo JS errors');
  check('no JS errors', errors.length === 0);
  done();
})().catch((e) => { console.error(e); process.exit(1); });

// API test in development "mock payment" mode (no Cashfree keys).
const { boot, client, check, done } = require('./helpers');
(async () => {
  const { base } = await boot({ CASHFREE_APP_ID: '', CASHFREE_SECRET_KEY: '' });
  const shop = client(base), admin = client(base), other = client(base);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log('Catalogue');
  let r = await shop.api('GET', '/api/products');
  check('10 products and config', r.json.products.length === 10 && r.json.config.freeShip === 999 && r.json.config.payments === 'mock');

  console.log('Static safety');
  for (const p of ['/server.js', '/.env', '/data/db.json', '/package.json', '/lib/db.js', '/assets/../server.js', '/media/../db.json']) {
    const x = await fetch(base + p); const t = await x.text();
    check('blocks ' + p, !/createServer|"counter"|MELTMARE store server/.test(t) && (x.status === 404 || /<div id="app">/.test(t)), x.status);
  }
  check('serves app.js', (await fetch(base + '/app.js')).status === 200);
  check('serves image', (await fetch(base + '/assets/img/cedar-dusk.jpg')).headers.get('content-type') === 'image/jpeg');
  check('SPA fallback', /<div id="app">/.test(await (await fetch(base + '/product/cedar-dusk')).text()));

  console.log('OTP login');
  r = await shop.api('POST', '/api/auth/request', { mode: 'email', id: 'not-an-email' });
  check('rejects bad email', r.status === 400);
  r = await shop.api('POST', '/api/auth/request', { mode: 'phone', id: '12345' });
  check('rejects bad phone', r.status === 400);
  r = await shop.api('POST', '/api/auth/request', { mode: 'email', id: 'Asha@Example.com' });
  const code = r.json.devOtp;
  check('code issued', r.status === 200 && /^\d{6}$/.test(code));
  r = await shop.api('POST', '/api/auth/request', { mode: 'email', id: 'asha@example.com' });
  check('resend within 30s blocked', r.status === 429);
  r = await shop.api('POST', '/api/auth/verify', { mode: 'email', id: 'asha@example.com', code: '000000' });
  check('wrong code rejected', r.status === 400, r.text);
  r = await shop.api('POST', '/api/auth/verify', { mode: 'email', id: 'asha@example.com', code });
  check('new user must give a name (code kept)', r.status === 422 && r.json.needName === true, r.text);
  r = await shop.api('POST', '/api/auth/verify', { mode: 'email', id: 'asha@example.com', code, name: 'Asha Rao' });
  check('verify creates user and cookie', r.status === 200 && r.json.user.name === 'Asha Rao' && shop.jar.mm_s, r.text);
  r = await shop.api('POST', '/api/auth/verify', { mode: 'email', id: 'asha@example.com', code, name: 'Asha Rao' });
  check('code cannot be reused', r.status === 400);
  r = await shop.api('GET', '/api/auth/me');
  check('me returns user', r.json.user && r.json.user.email === 'asha@example.com');
  // lockout after 5 wrong tries
  r = await other.api('POST', '/api/auth/request', { mode: 'phone', id: '9876543210' });
  const c2 = r.json.devOtp; let last;
  for (let i = 0; i < 5; i++) last = await other.api('POST', '/api/auth/verify', { mode: 'phone', id: '9876543210', code: c2 === '111111' ? '222222' : '111111' });
  r = await other.api('POST', '/api/auth/verify', { mode: 'phone', id: '9876543210', code: c2, name: 'Ravi' });
  check('locks after 5 wrong attempts, even with right code', r.status === 400 && !other.jar.mm_s, r.text);
  await sleep(31000 * 0); // resend gate not needed: new key below
  // forged cookie
  const forged = client(base); forged.jar.mm_s = shop.jar.mm_s.slice(0, -2) + 'xx';
  check('forged cookie rejected', (await forged.api('GET', '/api/auth/me')).json.user === null);

  console.log('CSRF guard');
  r = await shop.api('POST', '/api/contact', 'name=x&email=y', { 'Content-Type': 'text/plain' });
  check('non JSON post rejected', r.status === 415);
  r = await shop.api('POST', '/api/contact', { name: 'A', email: 'a@b.co', message: 'hi' }, { Origin: 'https://evil.example' });
  check('cross origin post rejected', r.status === 403);

  console.log('Orders');
  const addr = { name: 'Asha Rao', phone: '9876543210', line: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pin: '560001' };
  const unauth = await client(base).api('POST', '/api/orders', { items: [{ slug: 'cedar-dusk', qty: 1 }], address: addr });
  check('order needs login', unauth.status === 401);
  r = await shop.api('POST', '/api/orders', { items: [{ slug: 'rose-petal', qty: 1 }], address: addr });
  check('sold out item rejected', r.status === 400 && /sold out/.test(r.json.error), r.text);
  r = await shop.api('POST', '/api/orders', { items: [{ slug: 'lavender-haze', qty: 4 }], address: addr });
  check('over stock rejected', r.status === 400 && /Only 3/.test(r.json.error), r.text);
  r = await shop.api('POST', '/api/orders', { items: [{ slug: 'cedar-dusk', qty: 1 }], address: Object.assign({}, addr, { pin: '12' }) });
  check('bad pincode rejected', r.status === 400);
  r = await shop.api('POST', '/api/orders', { items: [{ slug: 'cedar-dusk', qty: -3 }], address: addr });
  check('negative qty rejected', r.status === 400);
  r = await shop.api('POST', '/api/orders', { items: [{ slug: 'cedar-dusk', qty: 1, price: 1 }], address: addr });
  check('under 999 adds delivery 79; client price ignored', r.status === 200 && r.json.order.total === 678 && r.json.order.delivery === 79 && r.json.order.number === 'MM000001', r.text);
  const o1 = r.json.order;
  check('starts as Pending payment with mock session', o1.status === 'Pending payment' && r.json.payment.mode === 'mock');
  check('stock reserved 24 -> 23', (await shop.api('GET', '/api/products')).json.products.find((p) => p.slug === 'cedar-dusk').stock === 23);
  r = await shop.api('POST', '/api/mock/pay', { id: o1.id, result: 'success' });
  r = await shop.api('GET', '/api/orders/' + o1.id);
  check('mock payment marks Paid', r.json.order.status === 'Paid');
  r = await shop.api('POST', '/api/orders', { items: [{ slug: 'cedar-dusk', qty: 2 }, { slug: 'cedar-dusk', qty: 1 }, { slug: 'vanilla-linen', qty: 1 }], address: addr });
  check('merges duplicate lines, free delivery over 999', r.status === 200 && r.json.order.subtotal === 599 * 3 + 549 && r.json.order.delivery === 0 && r.json.order.items.length === 2, r.text);
  const o2 = r.json.order;
  check('order numbers increment', o2.number === 'MM000002');
  r = await shop.api('POST', '/api/mock/pay', { id: o2.id, result: 'fail' });
  r = await shop.api('GET', '/api/orders');
  check('lists my orders newest first', r.json.orders.length === 2 && r.json.orders[0].number === 'MM000002');
  check('hides payment session', !JSON.stringify(r.json).includes('paymentSessionId'));
  r = await shop.api('POST', '/api/orders/' + o2.id + '/pay');
  check('can retry payment on pending order', r.status === 200 && r.json.payment.paymentSessionId.startsWith('mock_'));
  check("another user cannot see my order", (await other.api('GET', '/api/orders/' + o1.id)).status === 401);
  const b2 = client(base); let rr = await b2.api('POST', '/api/auth/request', { mode: 'email', id: 'b@example.com' });
  await b2.api('POST', '/api/auth/verify', { mode: 'email', id: 'b@example.com', code: rr.json.devOtp, name: 'Bee' });
  check('other logged in user gets 404 for my order', (await b2.api('GET', '/api/orders/' + o1.id)).status === 404);
  r = await shop.api('PATCH', '/api/me', { name: 'Asha R', email: 'asha@example.com', phone: '9876543210', address: '12 MG Road' });
  check('profile update', r.status === 200 && r.json.user.phone === '9876543210');
  r = await b2.api('PATCH', '/api/me', { name: 'Bee', email: 'b@example.com', phone: '9876543210' });
  check('duplicate phone refused', r.status === 400);

  console.log('Admin');
  check('admin routes closed', (await shop.api('GET', '/api/admin/orders')).status === 401);
  r = await admin.api('POST', '/api/admin/login', { email: 'admin@meltmare.com', password: 'wrong' });
  check('wrong admin password', r.status === 401);
  r = await admin.api('POST', '/api/admin/login', { email: 'admin@meltmare.com', password: 'test-admin-pass' });
  check('admin login', r.status === 200 && admin.jar.mm_a);
  r = await admin.api('GET', '/api/admin/summary');
  check('summary', r.json.ordersToday === 1 && r.json.revenueToday === 678 && r.json.toPack === 1 && r.json.lowStock === 2, r.text);
  r = await admin.api('PATCH', '/api/admin/products/rose-petal', { stock: 9, price: 619 });
  check('edit stock and price', r.json.product.stock === 9 && r.json.product.price === 619);
  r = await admin.api('PATCH', '/api/admin/products/rose-petal', { price: -5 });
  check('rejects bad price', r.status === 400);
  const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]).toString('base64');
  r = await admin.api('POST', '/api/admin/upload', { data: png });
  const url = r.json.url; check('image upload', r.status === 200 && /^\/media\/[0-9a-f]{16}\.png$/.test(url), r.text);
  check('uploaded image is served', (await fetch(base + url)).status === 200);
  r = await admin.api('POST', '/api/admin/upload', { data: 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64') });
  check('fake image refused', r.status === 400);
  r = await admin.api('POST', '/api/admin/products', { name: 'Test Chai', scent: 'Spiced', price: 499, stock: 7, notes: 'Cardamom, Tea', desc: 'x', image: url });
  check('add product', r.status === 200 && r.json.product.slug === 'test-chai' && r.json.product.notes.length === 2, r.text);
  check('new product is public', (await shop.api('GET', '/api/products')).json.products.some((p) => p.slug === 'test-chai'));
  await admin.api('PATCH', '/api/admin/products/test-chai', { active: false });
  check('hidden product not public', !(await shop.api('GET', '/api/products')).json.products.some((p) => p.slug === 'test-chai'));
  r = await admin.api('GET', '/api/admin/orders');
  check('admin sees orders with customer', r.json.orders.length === 2 && r.json.orders[1].customer.email === 'asha@example.com');
  r = await admin.api('PATCH', '/api/admin/orders/' + o1.id, { status: 'Shipped', tracking: 'AWB123' });
  check('mark shipped with tracking', r.json.order.status === 'Shipped' && r.json.order.tracking === 'AWB123');
  r = await admin.api('PATCH', '/api/admin/orders/' + o2.id, { status: 'Paid' });
  check('cannot mark pending as paid by hand', r.status === 400);
  const before = (await admin.api('GET', '/api/admin/products')).json.products.find((p) => p.slug === 'cedar-dusk').stock;
  r = await admin.api('PATCH', '/api/admin/orders/' + o2.id, { status: 'Cancelled' });
  const after = (await admin.api('GET', '/api/admin/products')).json.products.find((p) => p.slug === 'cedar-dusk').stock;
  check('cancel releases reserved stock', r.json.order.status === 'Cancelled' && after === before + 3, before + ' -> ' + after);
  r = await admin.api('POST', '/api/contact', { name: 'Neha', email: 'neha@example.com', message: 'Do you ship to Goa?' });
  r = await admin.api('GET', '/api/admin/messages');
  check('contact message reaches admin', r.json.messages.length === 1);
  await admin.api('POST', '/api/admin/logout');
  check('admin logout', (await admin.api('GET', '/api/admin/me')).json.admin === false);
  done();
})().catch((e) => { console.error(e); process.exit(1); });

// API test with Cashfree keys set. Cashfree's servers are replaced by a stub so no real call is made.
const crypto = require('crypto');
const { boot, client, check, done } = require('./helpers');

const calls = [];
let remoteStatus = 'ACTIVE';
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://sandbox.cashfree.com')) {
    calls.push({ url: String(url), opts });
    if ((opts && opts.method) === 'POST') { const b = JSON.parse(opts.body); return new Response(JSON.stringify({ cf_order_id: 1, order_id: b.order_id, payment_session_id: 'session_' + b.order_id, order_status: 'ACTIVE' }), { status: 200 }); }
    const id = decodeURIComponent(String(url).split('/').pop());
    const o = calls.filter((c) => c.opts.method === 'POST').map((c) => JSON.parse(c.opts.body)).find((b) => b.order_id === id);
    return new Response(JSON.stringify({ order_id: id, order_amount: o ? o.order_amount : 0, order_status: remoteStatus }), { status: 200 });
  }
  return realFetch(url, opts);
};

(async () => {
  const SECRET = 'test_secret_key';
  const { base, } = await boot({ CASHFREE_APP_ID: 'TEST_APP', CASHFREE_SECRET_KEY: SECRET, CASHFREE_ENV: 'sandbox', SITE_URL: 'https://meltmare.example' });
  const { sweep } = require('../server');
  const shop = client(base), admin = client(base), anon = client(base);
  const addr = { name: 'Asha Rao', phone: '9876543210', line: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pin: '560001' };
  let r = await shop.api('POST', '/api/auth/request', { mode: 'email', id: 'asha@example.com' });
  await shop.api('POST', '/api/auth/verify', { mode: 'email', id: 'asha@example.com', code: r.json.devOtp, name: 'Asha' });
  check('config reports sandbox', (await shop.api('GET', '/api/products')).json.config.payments === 'sandbox');

  console.log('Create order');
  r = await shop.api('POST', '/api/orders', { items: [{ slug: 'cedar-dusk', qty: 1 }], address: addr });
  const o1 = r.json.order, c = calls[0], sent = JSON.parse(c.opts.body);
  check('returns session id for Cashfree JS', r.json.payment.paymentSessionId === 'session_' + o1.number && r.json.payment.mode === 'sandbox', r.text);
  check('calls sandbox /pg/orders with credentials', c.url === 'https://sandbox.cashfree.com/pg/orders' && c.opts.headers['x-client-id'] === 'TEST_APP' && c.opts.headers['x-client-secret'] === SECRET && c.opts.headers['x-api-version'] === '2023-08-01');
  check('sends server computed amount', sent.order_amount === 678 && sent.order_currency === 'INR' && sent.order_id === o1.number);
  check('return and notify urls', sent.order_meta.return_url === 'https://meltmare.example/order/' + o1.id && sent.order_meta.notify_url === 'https://meltmare.example/api/cashfree/webhook');
  check('customer details', sent.customer_details.customer_phone === '9876543210' && sent.customer_details.customer_email === 'asha@example.com');
  check('no mock endpoint when keys are set', (await shop.api('POST', '/api/mock/pay', { id: o1.id, result: 'success' })).status === 404);

  console.log('Webhook');
  const payload = (type, num, amt) => JSON.stringify({ type, data: { order: { order_id: num, order_amount: amt }, payment: { payment_status: type.includes('SUCCESS') ? 'SUCCESS' : 'FAILED' } } });
  const sig = (ts, body) => crypto.createHmac('sha256', SECRET).update(ts + body).digest('base64');
  const post = (body, ts, s) => anon.api('POST', '/api/cashfree/webhook', body, { 'Content-Type': 'application/json', 'x-webhook-timestamp': ts, 'x-webhook-signature': s });
  let body = payload('PAYMENT_SUCCESS_WEBHOOK', o1.number, 678);
  check('rejects bad signature', (await post(body, '1700000000', 'AAAA')).status === 401);
  check('rejects signature for different body', (await post(body, '1700000000', sig('1700000000', body + ' '))).status === 401);
  check('order still pending', (await shop.api('GET', '/api/orders/' + o1.id)).json.order.status === 'Pending payment');
  body = payload('PAYMENT_SUCCESS_WEBHOOK', o1.number, 1);
  check('amount mismatch ignored', (await post(body, '1700000001', sig('1700000001', body))).status === 200 && (await shop.api('GET', '/api/orders/' + o1.id)).json.order.status === 'Pending payment');
  body = payload('PAYMENT_FAILED_WEBHOOK', o1.number, 678);
  await post(body, '1700000002', sig('1700000002', body));
  check('failed webhook leaves order pending', (await shop.api('GET', '/api/orders/' + o1.id)).json.order.status === 'Pending payment');
  body = payload('PAYMENT_SUCCESS_WEBHOOK', o1.number, 678);
  check('valid success webhook accepted', (await post(body, '1700000003', sig('1700000003', body))).status === 200);
  check('order is Paid', (await shop.api('GET', '/api/orders/' + o1.id)).json.order.status === 'Paid');
  await post(body, '1700000003', sig('1700000003', body));
  const stock = (await shop.api('GET', '/api/products')).json.products.find((p) => p.slug === 'cedar-dusk').stock;
  check('duplicate webhook is harmless (stock still 23)', stock === 23, stock);

  console.log('Return page verification');
  r = await shop.api('POST', '/api/orders', { items: [{ slug: 'vanilla-linen', qty: 2 }], address: addr });
  const o2 = r.json.order;
  remoteStatus = 'ACTIVE';
  check('active at Cashfree stays pending', (await shop.api('GET', '/api/orders/' + o2.id)).json.order.status === 'Pending payment');
  remoteStatus = 'PAID';
  check('paid at Cashfree becomes Paid via server check', (await shop.api('GET', '/api/orders/' + o2.id)).json.order.status === 'Paid');

  console.log('Expiry sweep');
  remoteStatus = 'ACTIVE';
  r = await shop.api('POST', '/api/orders', { items: [{ slug: 'jasmine-night', qty: 2 }], address: addr });
  const o3 = r.json.order;
  const s1 = (await shop.api('GET', '/api/products')).json.products.find((p) => p.slug === 'jasmine-night').stock;
  await sweep(60 * 60000);
  check('fresh pending order untouched', (await shop.api('GET', '/api/orders/' + o3.id)).json.order.status === 'Pending payment');
  await sweep(-1);
  check('old unpaid order auto cancelled', (await shop.api('GET', '/api/orders/' + o3.id)).json.order.status === 'Cancelled');
  const s2 = (await shop.api('GET', '/api/products')).json.products.find((p) => p.slug === 'jasmine-night').stock;
  check('stock returned on auto cancel', s2 === s1 + 2, s1 + ' -> ' + s2);
  check('cannot pay a cancelled order', (await shop.api('POST', '/api/orders/' + o3.id + '/pay')).status === 400);

  console.log('Late payment after cancel');
  body = payload('PAYMENT_SUCCESS_WEBHOOK', o3.number, o3.total);
  await post(body, '1700000009', sig('1700000009', body));
  const late = (await shop.api('GET', '/api/orders/' + o3.id)).json.order;
  const s3 = (await shop.api('GET', '/api/products')).json.products.find((p) => p.slug === 'jasmine-night').stock;
  check('late payment marks Paid and re-reserves stock', late.status === 'Paid' && s3 === s1 && /after the order had been cancelled/.test(late.note || ''), JSON.stringify(late.status) + ' ' + s3);

  console.log('Provider failure');
  const realF = global.fetch;
  global.fetch = async (url, opts) => String(url).startsWith('https://sandbox.cashfree.com') ? new Response('{}', { status: 500 }) : realF(url, opts);
  const sBefore = (await shop.api('GET', '/api/products')).json.products.find((p) => p.slug === 'amber-ember').stock;
  r = await shop.api('POST', '/api/orders', { items: [{ slug: 'amber-ember', qty: 1 }], address: addr });
  const sAfter = (await shop.api('GET', '/api/products')).json.products.find((p) => p.slug === 'amber-ember').stock;
  check('Cashfree error: friendly message, stock released, no ghost order', r.status === 502 && sBefore === sAfter && (await shop.api('GET', '/api/orders')).json.orders.length === 3, r.text);
  global.fetch = realF;
  done();
})().catch((e) => { console.error(e); process.exit(1); });

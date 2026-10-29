// Shared helpers for the API tests: boots the server in-process on a random port with a throwaway data folder.
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.boot = function (env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meltmare-test-'));
  Object.assign(process.env, { DATA_DIR: dir, DEV_SHOW_OTP: '1', DEV_ADMIN_PASSWORD: 'test-admin-pass', SITE_URL: 'http://localhost', NODE_ENV: 'test' }, env || {});
  const { server } = require('../server');
  return new Promise((resolve) => server.listen(0, () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port, dir })));
};

exports.client = function (base) {
  const jar = {};
  const api = async (method, url, body, extraHeaders) => {
    const headers = Object.assign({}, extraHeaders || {});
    if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const c = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
    if (c) headers.Cookie = c;
    const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((sc) => {
      const [kv, ...attrs] = sc.split(';'); const i = kv.indexOf('=');
      const name = kv.slice(0, i), val = decodeURIComponent(kv.slice(i + 1));
      if (/Max-Age=0/i.test(attrs.join(';')) || !val) delete jar[name]; else jar[name] = val;
    });
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, json: json || {}, text };
  };
  return { api, jar };
};

let failures = 0;
exports.check = (name, cond, extra) => { if (cond) console.log('  ok   ' + name); else { failures++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); } };
exports.done = () => { console.log(failures ? '\n' + failures + ' check(s) failed' : '\nAll checks passed'); process.exit(failures ? 1 : 0); };

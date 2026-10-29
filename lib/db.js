// Tiny JSON file database: simple, dependency free, fine for a small store.
// For higher volume move to Postgres/SQLite; the rest of the code only uses these helpers.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./env');
const SEED = require('./seed');

const FILE = path.join(cfg.dataDir, 'db.json');
fs.mkdirSync(cfg.dataDir, { recursive: true });
fs.mkdirSync(path.join(cfg.dataDir, 'uploads'), { recursive: true });

let data;
function fresh() {
  return { counter: 0, products: SEED.map((p) => Object.assign({ createdAt: Date.now() }, p)), users: [], orders: [], messages: [], subscribers: [], otps: {} };
}
if (fs.existsSync(FILE)) {
  try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { fs.copyFileSync(FILE, FILE + '.corrupt-' + Date.now()); data = fresh(); }
} else data = fresh();
for (const k of Object.keys(fresh())) if (data[k] === undefined) data[k] = fresh()[k];

let timer = null;
function flush() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}
function persist() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; try { flush(); } catch (e) { console.error('db write failed', e.message); } }, 50);
}
function saveNow() { if (timer) { clearTimeout(timer); timer = null; } flush(); }
process.on('exit', () => { try { if (timer) flush(); } catch (e) {} });
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => { try { saveNow(); } catch (e) {} process.exit(0); }));
saveNow();

const id = (prefix) => prefix + crypto.randomBytes(8).toString('hex');
function nextOrderNumber() { data.counter += 1; return 'MM' + String(data.counter).padStart(6, '0'); }

module.exports = { data, persist, saveNow, id, nextOrderNumber };

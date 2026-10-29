// Usage: node scripts/hash-password.js "your admin password"
// Put the printed value in .env as ADMIN_PASSWORD_HASH
const { hashPassword } = require('../lib/auth');
const pw = process.argv[2];
if (!pw || pw.length < 10) { console.error('Usage: node scripts/hash-password.js "a password of at least 10 characters"'); process.exit(1); }
console.log('ADMIN_PASSWORD_HASH=' + hashPassword(pw));

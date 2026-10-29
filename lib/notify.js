// Sends OTP codes and order emails. Providers are chosen with env vars; "console" prints to the server log (development only).
const cfg = require('./env');

async function sendEmail(to, subject, html, text) {
  if (cfg.otp.emailProvider === 'resend' && cfg.otp.resendKey) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.otp.resendKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.otp.mailFrom, to: [to], subject, html, text })
    });
    if (!r.ok) throw new Error('Email provider error ' + r.status);
    return true;
  }
  if (cfg.production) throw new Error('Email provider is not configured');
  console.log('[email:dev] to=' + to + ' subject=' + subject + '\n' + (text || '').slice(0, 400));
  return false;
}

async function sendSms(phone10, otp) {
  if (cfg.otp.smsProvider === 'msg91' && cfg.otp.msg91Key && cfg.otp.msg91Template) {
    // MSG91 OTP API. Needs a DLT registered sender and template (India rule).
    const url = 'https://control.msg91.com/api/v5/otp?template_id=' + encodeURIComponent(cfg.otp.msg91Template) + '&mobile=91' + phone10 + '&otp=' + otp;
    const r = await fetch(url, { method: 'POST', headers: { authkey: cfg.otp.msg91Key, 'Content-Type': 'application/json' }, body: '{}' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.type === 'error') throw new Error('SMS provider error');
    return true;
  }
  if (cfg.production) throw new Error('SMS provider is not configured');
  console.log('[sms:dev] to=+91' + phone10 + ' code=' + otp);
  return false;
}

async function sendOtp(mode, id, otp) {
  if (mode === 'phone') return sendSms(id, otp);
  const text = 'Your MELTMARE sign in code is ' + otp + '. It is valid for 10 minutes. If you did not ask for it, you can ignore this email.';
  return sendEmail(id, 'Your MELTMARE sign in code', '<p>Your MELTMARE sign in code is</p><p style="font-size:28px;letter-spacing:6px"><b>' + otp + '</b></p><p>It is valid for 10 minutes. If you did not ask for it, you can ignore this email.</p>', text);
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function orderEmail(order) {
  const rows = order.items.map((i) => '<tr><td>' + esc(i.name) + ' × ' + i.qty + '</td><td style="text-align:right">₹' + i.price * i.qty + '</td></tr>').join('');
  return '<h2>Thank you for your order</h2><p>Order <b>' + order.number + '</b> is confirmed.</p><table width="100%">' + rows + '<tr><td>Delivery</td><td style="text-align:right">' + (order.delivery ? '₹' + order.delivery : 'Free') + '</td></tr><tr><td><b>Total</b></td><td style="text-align:right"><b>₹' + order.total + '</b></td></tr></table><p>We will ship to ' + esc(order.address.name) + ', ' + esc(order.address.line) + ', ' + esc(order.address.city) + ' ' + esc(order.address.pin) + '.</p><p>You can follow your order any time in My account.</p>';
}
async function orderPaid(order, user) {
  try {
    if (user && user.email) await sendEmail(user.email, 'Your MELTMARE order ' + order.number + ' is confirmed', orderEmail(order), 'Order ' + order.number + ' confirmed. Total Rs ' + order.total);
    if (cfg.notifyEmail) await sendEmail(cfg.notifyEmail, 'New paid order ' + order.number + ' (₹' + order.total + ')', orderEmail(order), 'New paid order ' + order.number + ' Rs ' + order.total);
  } catch (e) { console.error('order email failed:', e.message); }
}
module.exports = { sendOtp, orderPaid };

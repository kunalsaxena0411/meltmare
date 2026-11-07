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

async function sendSms(phone, otp) {
  // 1. MSG91 (DLT registered sender ID & approved template in India)
  if (cfg.otp.smsProvider === 'msg91' && cfg.otp.msg91Key && cfg.otp.msg91Template) {
    const mobile = phone.length === 10 ? '91' + phone : phone.replace(/^\+/, '');
    const url = 'https://control.msg91.com/api/v5/otp?template_id=' + encodeURIComponent(cfg.otp.msg91Template) + '&mobile=' + mobile + '&otp=' + otp;
    const r = await fetch(url, { method: 'POST', headers: { authkey: cfg.otp.msg91Key, 'Content-Type': 'application/json' }, body: '{}' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.type === 'error') throw new Error('MSG91 error: ' + (j.message || r.status));
    return true;
  }

  // 2. 2Factor (India OTP provider with instant testing & DLT support)
  if (cfg.otp.smsProvider === '2factor' && cfg.otp.twoFactorKey) {
    const mobile = phone.length === 10 ? '91' + phone : phone.replace(/^\+/, '');
    const tmpl = cfg.otp.twoFactorTemplate ? '/' + encodeURIComponent(cfg.otp.twoFactorTemplate) : '';
    const url = 'https://2factor.in/API/V1/' + encodeURIComponent(cfg.otp.twoFactorKey) + '/SMS/' + mobile + '/' + otp + tmpl;
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.Status !== 'Success') throw new Error('2Factor error: ' + (j.Details || r.status));
    return true;
  }

  // 3. Twilio (Global SMS delivery)
  if (cfg.otp.smsProvider === 'twilio' && cfg.otp.twilioSid && cfg.otp.twilioToken && cfg.otp.twilioFrom) {
    const mobile = phone.startsWith('+') ? phone : (phone.length === 10 ? '+91' + phone : '+' + phone);
    const url = 'https://api.twilio.com/2010-04-01/Accounts/' + cfg.otp.twilioSid + '/Messages.json';
    const auth = Buffer.from(cfg.otp.twilioSid + ':' + cfg.otp.twilioToken).toString('base64');
    const body = new URLSearchParams({
      To: mobile,
      From: cfg.otp.twilioFrom,
      Body: 'Your MELTMERE verification code is ' + otp + '. It is valid for 10 minutes.'
    });
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!r.ok) {
      const err = await r.text();
      throw new Error('Twilio error: ' + r.status + ' ' + err);
    }
    return true;
  }

  // 4. Console log fallback (Development & test mode)
  if (cfg.production) throw new Error('SMS provider is not configured. Please set MSG91, 2Factor, or Twilio in .env');
  console.log('[sms:dev] to=' + (phone.length === 10 ? '+91' + phone : phone) + ' code=' + otp);
  return false;
}

async function sendOtp(mode, id, otp) {
  if (mode === 'email') throw new Error('Sign in is only available via mobile number OTP.');
  return sendSms(id, otp);
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function orderEmail(order) {
  const rows = order.items.map((i) => '<tr><td>' + esc(i.name) + ' × ' + i.qty + '</td><td style="text-align:right">₹' + i.price * i.qty + '</td></tr>').join('');
  return '<h2>Thank you for your order</h2><p>Order <b>' + order.number + '</b> is confirmed.</p><table width="100%">' + rows + '<tr><td>Delivery</td><td style="text-align:right">' + (order.delivery ? '₹' + order.delivery : 'Free') + '</td></tr><tr><td><b>Total</b></td><td style="text-align:right"><b>₹' + order.total + '</b></td></tr></table><p>We will ship to ' + esc(order.address.name) + ', ' + esc(order.address.line) + ', ' + esc(order.address.city) + ' ' + esc(order.address.pin) + '.</p><p>You can follow your order any time in My account.</p>';
}
async function orderPaid(order, user) {
  try {
    if (user && user.email) await sendEmail(user.email, 'Your MELTMERE order ' + order.number + ' is confirmed', orderEmail(order), 'Order ' + order.number + ' confirmed. Total Rs ' + order.total);
    if (cfg.notifyEmail) await sendEmail(cfg.notifyEmail, 'New paid order ' + order.number + ' (₹' + order.total + ')', orderEmail(order), 'New paid order ' + order.number + ' Rs ' + order.total);
  } catch (e) { console.error('order email failed:', e.message); }
}
module.exports = { sendOtp, orderPaid };

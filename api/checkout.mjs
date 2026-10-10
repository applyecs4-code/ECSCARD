// POST /api/checkout   (plain HTML form on e-learning-checkout.html and e-learning-checkout-2.html)
// Saves the candidate's details as an enquiry (Admin > Enquiries), emails the team, then shows a thank-you page.
// Optional env: ELEARNING_PAYMENT_URL = https://... (payment / Stripe payment link). If set, the candidate is sent there afterwards.
import { sb, must, esc, validEmail, clientIp, rateLimited, logAction, notifyEmails, sendMail } from '../lib/core.mjs';

const html = (title, msg, status = 200) => new Response(
  `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>` +
  `<style>body{font-family:Inter,Segoe UI,Arial,sans-serif;background:#f6f7f9;color:#1f2937;display:grid;place-items:center;min-height:100vh;margin:0}.c{background:#fff;padding:32px;border-radius:14px;max-width:460px;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center}h1{color:#0a2f5c;margin:0 0 10px}a{color:#d42029;font-weight:700}</style></head>` +
  `<body><div class="c"><h1>${esc(title)}</h1><p>${esc(msg)}</p><p><a href="/">Back to home</a></p></div></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

async function handler(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return new Response(null, { status: 303, headers: { location: '/e-learning-checkout', 'cache-control': 'no-store' } });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const ip = clientIp(req);
  let fd; try { fd = await req.formData(); } catch { return html('Please check your details', 'Invalid form submission. Please go back and try again.', 400); }
  const v = (k, n = 200) => (typeof fd.get(k) === 'string' ? fd.get(k).replace(/[\r\n]+/g, ' ').trim().slice(0, n) : '');

  const first = v('first_name', 80), last = v('last_name', 80), email = v('email'), phone = v('phone', 50);
  const dob = [v('dob_day', 2), v('dob_month', 12), v('dob_year', 4)].join(' ').trim();
  if (first.length < 2 || last.length < 2 || !validEmail(email) || email.toLowerCase() !== v('confirm_email').toLowerCase() || phone.replace(/\D/g, '').length < 7 || !v('terms_accepted'))
    return html('Please check your details', 'Some required details are missing or invalid. Please go back and try again.', 400);
  try { if (await rateLimited('hits', 'c:' + ip, 10, 3600)) return html('Too many requests', 'Please try again later.', 429); } catch (e) { console.error(e.message); }

  const rows = [
    ['Name', `${first} ${last}`], ['Email', email], ['Phone', phone], ['Date of birth', dob],
    ['Company', v('company_name')], ['Limited/PLC company', v('is_limited_company', 5)],
    ['Address', [v('address_line_1'), v('city'), v('postcode', 20)].filter(Boolean).join(', ')],
    ['Opted out of marketing email', v('opt_out_email_marketing') ? 'Yes' : 'No'], ['Page', req.headers.get('referer') || ''],
  ].filter(([, x]) => x);
  const message = rows.map(([k, x]) => `${k}: ${x}`).join('\n');

  let saved = false;
  try { must(await sb().from('enquiries').insert({ name: `${first} ${last}`, email, phone, subject: 'E-learning checkout', message })); saved = true; }
  catch (e) { console.error('checkout save:', e.message); }
  const sent = await sendMail({
    to: await notifyEmails(), subject: 'New E-learning checkout', replyTo: email,
    html: `<h2>New E-learning checkout</h2><p>${rows.map(([k, x]) => `<b>${esc(k)}:</b> ${esc(x)}`).join('<br>')}</p>`,
  });
  await logAction('elearning_checkout', `${first} ${last} <${email}>`, ip);
  if (!saved && !sent) return html('Sorry, something went wrong', 'We could not save your details. Please email booking@applyecscard.co.uk.', 500);

  const pay = process.env.ELEARNING_PAYMENT_URL || '';
  if (/^https:\/\//.test(pay)) return new Response(null, { status: 303, headers: { location: pay, 'cache-control': 'no-store' } });
  return html('Thank you!', 'Your details have been received. Our team will contact you shortly with the next steps for your e-learning course.');
}

export default { fetch: handler };

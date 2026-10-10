// POST /api/create-checkout-session   (called by cart.html)
// Body: { customer: { first_name, last_name, email, phone }, items: [{ id, qty }] }
// Returns { url } -> the browser is redirected to Stripe Checkout.
// Prices come from lib/courses.generated.mjs (built from site/courses-data.js), NEVER from the browser.
// Needs env: STRIPE_SECRET_KEY   (optional: SITE_URL = https://applyecscard.co.uk)
import courses from '../lib/courses.generated.mjs';

const MAP = new Map(courses.map((c) => [c.id, c]));
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const clean = (v, n) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, n) : '');

async function handler(req) {
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { console.error('STRIPE_SECRET_KEY is not set in Vercel environment variables'); return reply({ error: 'Online payment is not available right now. Please contact us.' }, 500); }

  let d; try { d = await req.json(); } catch { return reply({ error: 'Invalid request' }, 400); }
  const c = d?.customer || {};
  const first = clean(c.first_name, 80), last = clean(c.last_name, 80), email = clean(c.email, 200), phone = clean(c.phone, 40);
  if (first.length < 2 || last.length < 2) return reply({ error: 'Please enter first and last name.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'Please enter a valid email.' }, 400);
  if (phone.replace(/\D/g, '').length < 7) return reply({ error: 'Please enter a valid phone number.' }, 400);

  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 30)
    .map((i) => ({ course: MAP.get(String(i?.id)), qty: Math.max(1, Math.min(50, Math.floor(Number(i?.qty)) || 1)) }))
    .filter((i) => i.course && i.course.price > 0);
  if (!items.length) return reply({ error: 'Your cart is empty.' }, 400);

  const origin = (process.env.SITE_URL || new URL(req.url).origin).replace(/\/+$/, '');
  const f = new URLSearchParams();
  f.set('mode', 'payment');
  f.set('success_url', `${origin}/cart?paid=1`);
  f.set('cancel_url', `${origin}/cart`);
  f.set('customer_email', email);
  items.forEach((i, n) => {
    f.set(`line_items[${n}][quantity]`, String(i.qty));
    f.set(`line_items[${n}][price_data][currency]`, 'gbp');
    f.set(`line_items[${n}][price_data][unit_amount]`, String(Math.round(i.course.price * 120))); // price + 20% VAT, in pence
    f.set(`line_items[${n}][price_data][product_data][name]`, `${i.course.name} (inc. 20% VAT)`);
  });
  f.set('metadata[candidate]', `${first} ${last}`);
  f.set('metadata[phone]', phone);
  f.set('metadata[courses]', items.map((i) => `${i.course.name} x${i.qty}`).join('; ').slice(0, 480));
  f.set('payment_intent_data[description]', `Apply ECS - ${first} ${last}`.slice(0, 200));

  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' }, body: f,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) { console.error('Stripe error:', r.status, j?.error?.message); return reply({ error: 'Payment could not be started. Please try again or contact us.' }, 502); }
    return reply({ url: j.url });
  } catch (e) { console.error('Stripe request failed:', e.message); return reply({ error: 'Payment could not be started. Please try again.' }, 502); }
}

export default { fetch: handler };

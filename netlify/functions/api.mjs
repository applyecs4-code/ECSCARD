// One Netlify Function that serves the whole admin API + the public form endpoints.
import crypto from 'node:crypto';
import {
  BUCKET, STATUSES, ENQ_STATUSES, PROTECTED_PAGES, INCOMING_RE,
  sb, must, json, esc, validSlug, validEmail, getSetting, setSetting, clientIp, logAction, rateLimited,
  adminCreds, checkPassword, hashPassword, makeSessionCookie, clearSessionCookie, hasSession, guard,
  notifyEmails, sendMail, mailConfigured, sniffFile,
} from '../lib/core.mjs';
import { FIELDS, FONTS, sanitizeDesign, buildCss } from '../lib/design.mjs';
import { slugify, safeCourseUrl, BLOG_STATUSES, indexPage, postPage, sitemapXml } from '../lib/blog.mjs';
import { BLOG_SEED } from '../lib/blog-seed.mjs';
import { SETUP_SQL } from '../lib/setup-sql.mjs';

export const config = { path: '/admin-api/*' };

const MAX_FILE = 15 * 1024 * 1024;
const MAX_ATTACH_TOTAL = 18 * 1024 * 1024;
const FILE_KINDS = { id_file: 'ID document', photo_file: 'Applicant photo', file3: 'H&S test proof' };
const rand = () => crypto.randomBytes(12).toString('hex');
const body = async (req) => { try { return await req.json(); } catch { return {}; } };
const londonDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d); // YYYY-MM-DD

export default async (req, context) => {
  const url = new URL(req.url);
  const p = url.pathname.replace(/^\/admin-api/, "").replace(/\/+$/, "") || "/";
  const m = req.method;
  const ip = clientIp(req, context);
  let r, x0;
  try {
    if (m === 'POST' && /(^|\/)(receive|enquiry)(\.php)?$|^\/(upload-url|cart-event|ping)$/.test(p) && (await isBlocked(ip))) {
      if (/enquiry/.test(p)) return page('Blocked', 'Your request could not be processed.', 403);
      return /receive|upload-url/.test(p) ? json({ success: false, error: 'Your request could not be processed.' }, 403) : json({ ok: true }); // tracking: pretend all is fine
    }
    // ---------- public ----------
    // Opening these URLs in the browser (GET) used to show "Method Not Allowed": send people to the contact page instead.
    if (/(^|\/)(receive|enquiry)(\.php)?$/.test(p) && (m === 'GET' || m === 'HEAD')) return new Response(null, { status: 303, headers: { location: '/contact.html', 'cache-control': 'no-store' } });
    if (/(^|\/)receive(\.php)?$/.test(p) && m === 'POST') return await receive(req, url, ip);
    if (/(^|\/)enquiry(\.php)?$/.test(p) && m === 'POST') return await enquiry(req, ip);
    if (p === '/upload-url' && m === 'POST') return await uploadUrl(req, ip);
    if (/site-css|site-custom\.css/.test(p) && m === 'GET') return await siteCss();
    if (p === '/cart-event' && m === 'POST') return await cartEvent(req, url, ip);
    if ((p === '/blog-index' || p === '/blog-sitemap') && m === 'GET') return await blogPublicIndex(p === '/blog-sitemap');
    if ((x0 = p.match(/^\/blog-post\/([A-Za-z0-9_-]+)$/)) && m === 'GET') return await blogPublicPost(x0[1], req);
    if (p === '/hidden' && m === 'GET') return await hiddenPublic();
    if (p === '/ping' && m === 'POST') return await ping(req, ip, context);
    if (p === '/login' && m === 'POST') return await login(req, ip);
    if (p === '/logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
    if (p === '/me') return hasSession(req) ? json({ ok: true }) : json({ error: 'Not logged in' }, 401);

    // ---------- admin (cookie required) ----------
    if ((r = guard(req))) return r;
    let x;
    if (p === '/counts' && m === 'GET') return await counts();
    if (p === '/customers' && m === 'GET') return await customersList();
    if (p === '/customers.csv' && m === 'GET') return await customersCsv();
    if (p === '/customer' && m === 'GET') return await customerOne(url);
    if (p === '/leads' && m === 'GET') return await leadsList();
    if (p === '/leads' && m === 'POST') return await leadsMark(req, ip);
    if (p === '/search' && m === 'GET') return await searchAll(url);
    if (p === '/reports' && m === 'GET') return await reports(url);
    if (p === '/reports.csv' && m === 'GET') return await reportsCsv(url);
    if (p === '/blocked' && m === 'GET') return json(await getSetting('blocked_ips', []));
    if (p === '/blocked' && m === 'POST') return await blockedSave(req, ip);
    if (p === '/bookings' && m === 'GET') return await bookingsList(url);
    if (p === '/bookings.csv' && m === 'GET') return await bookingsCsv(url);
    if (p === '/bookings/bulk' && m === 'POST') return await bookingsBulk(req, ip);
    if ((x = p.match(/^\/bookings\/(\d+)$/))) {
      if (m === 'GET') return await bookingGet(+x[1]);
      if (m === 'PATCH') return await bookingSave(+x[1], req, ip);
      if (m === 'DELETE') return await bookingDelete(+x[1], ip);
    }
    if ((x = p.match(/^\/bookings\/(\d+)\/email$/)) && m === 'POST') return await bookingEmail(+x[1], req, ip);
    if ((x = p.match(/^\/file\/(\d+)\/(id_file|photo_file|file3)$/)) && m === 'GET') return await fileRedirect(+x[1], x[2]);
    if (p === '/enquiries' && m === 'GET') return json(must(await sb().from('enquiries').select('*').order('id', { ascending: false }).limit(300)));
    if ((x = p.match(/^\/enquiries\/(\d+)$/)) && m === 'POST') return await enquiryAction(+x[1], req, ip);
    if (p === '/setup-sql' && m === 'GET') return new Response(SETUP_SQL, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    if (p === '/blogs' && m === 'GET') return await blogsList();
    if (p === '/blogs' && m === 'POST') return await blogSave(0, req, ip);
    if ((x = p.match(/^\/blogs\/(\d+)$/))) {
      if (m === 'POST') return await blogSave(+x[1], req, ip);
      if (m === 'DELETE') return await blogDelete(+x[1], ip);
    }
    if (p === '/cart' && m === 'GET') return json(must(await sb().from('cart_events').select('*').order('id', { ascending: false }).limit(300)));
    if ((x = p.match(/^\/cart\/(\d+)$/)) && m === 'DELETE') { must(await sb().from('cart_events').delete().eq('id', +x[1])); return json({ ok: true }); }
    if (p === '/live' && m === 'GET') return await liveList();
    if (p === '/dashboard' && m === 'GET') return await dashboard();
    if (p === '/upcoming' && m === 'GET') return json(must(await sb().from('bookings').select('id,full_name,mobile,email,test_type,centre,test_date,test_time,status').neq('test_date', '').neq('status', 'Cancelled').order('id', { ascending: false }).limit(2000)));
    if (p === '/export/enquiries.csv' && m === 'GET') return csvResponse('enquiries.csv', must(await sb().from('enquiries').select('*').order('id', { ascending: false }).limit(5000)));
    if (p === '/export/cart.csv' && m === 'GET') return csvResponse('cart-activity.csv', must(await sb().from('cart_events').select('*').order('id', { ascending: false }).limit(5000)));
    if (p === '/backup.json' && m === 'GET') return await backup(ip);
    if (p === '/menu' && m === 'GET') return json(await getSetting('menu_hide', { href: [], text: [], words: [] }));
    if (p === '/menu' && m === 'POST') return await menuSave(req, ip);
    if (p === '/autoreply' && m === 'POST') return await autoreplySave(req, ip);
    if (p === '/stats' && m === 'GET') return await stats();
    if (p === '/pages' && m === 'GET') return await pagesList(url);
    if (p === '/pages' && m === 'POST') return await pagesAction(req, url, ip);
    if (p === '/design' && m === 'GET') return json({ fields: FIELDS, fonts: FONTS, values: await getSetting('design', {}) });
    if (p === '/design' && m === 'POST') return await designSave(req, ip);
    if (p === '/settings' && m === 'GET') return json({ notify: await getSetting('notify', ''), mailConfigured: mailConfigured(), autoreply: await autoreplyCfg() });
    if (p === '/settings' && m === 'POST') return await settingsSave(req, ip);
    if (p === '/account' && m === 'GET') return json({ email: (await adminCreds()).email });
    if (p === '/account' && m === 'POST') return await accountSave(req, ip);
    if (p === '/log' && m === 'GET') return json(must(await sb().from('log').select('*').order('id', { ascending: false }).limit(300)));
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error(`api ${m} ${p}:`, e);
    return json({ error: 'Server error: ' + e.message }, 500);
  }
};

// =====================================================================
// PUBLIC: documents -> direct-to-storage upload (avoids Netlify's 6 MB request limit)
// =====================================================================
async function uploadUrl(req, ip) {
  if (await rateLimited('hits', 'u:' + ip, 30, 3600)) return json({ error: 'Too many uploads. Please try again later.' }, 429);
  const d = await body(req);
  const ext = String(d.name || '').toLowerCase().split('.').pop();
  if (!['jpg', 'jpeg', 'png', 'pdf', 'webp'].includes(ext)) return json({ error: 'Only JPG, PNG, WEBP or PDF files are allowed.' }, 400);
  if (!(Number(d.size) > 0) || Number(d.size) > MAX_FILE) return json({ error: 'File must be under 15MB.' }, 400);
  const path = `incoming/${rand()}.${ext === 'jpeg' ? 'jpg' : ext}`;
  const { data, error } = await sb().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(error.message);
  return json({ path, signedUrl: data.signedUrl });
}

// Turn a form value (data: URL or storage path) into {path, buf, ext, mime} or null. Stored under docs/.
async function takeFile(v) {
  if (typeof v !== 'string' || !v) return null;
  let buf, fromPath = null;
  if (v.startsWith('data:')) {
    const m = v.match(/^data:[\w/+.-]+;base64,(.+)$/s);
    if (!m) return null;
    buf = Buffer.from(m[1], 'base64');
  } else if (INCOMING_RE.test(v)) {
    const { data, error } = await sb().storage.from(BUCKET).download(v);
    if (error || !data) return null;
    buf = Buffer.from(await data.arrayBuffer()); fromPath = v;
  } else return null;
  const t = buf.length && buf.length <= MAX_FILE ? sniffFile(buf) : null;
  if (!t) { if (fromPath) await sb().storage.from(BUCKET).remove([fromPath]); return null; }
  const path = `docs/${rand()}.${t.ext}`;
  if (fromPath) must(await sb().storage.from(BUCKET).move(fromPath, path));
  else must(await sb().storage.from(BUCKET).upload(path, buf, { contentType: t.mime, upsert: false }));
  return { path, buf, ext: t.ext, mime: t.mime };
}

// =====================================================================
// PUBLIC: booking forms (book.html + ecscardbooking.html -> /admin/receive.php)
// =====================================================================
const MAPPED = ['full_name', 'dob', 'ni_number', 'gender', 'street_address', 'city', 'postcode', 'mobile', 'email', 'confirm_email', 'ecs_card_type', 'test_type', 'test_language', 'test_centre', 'test_date', 'test_time'];
const FILE_FIELDS = { id_proof: 'id-proof', photo: 'passport-photo', hs_test_proof: 'hs-test-proof' };

async function receive(req, url, ip) {
  const out = (ok, err = '', code = 200) => json(ok ? { success: true } : { success: false, error: err }, code);
  const d = await body(req);
  if (!d || typeof d !== 'object' || !Object.keys(d).length) return out(false, 'Invalid request', 400);
  try { if (await rateLimited('hits', ip, 20, 3600)) return out(false, 'Too many submissions. Please try again later.', 429); } catch (e) { console.error(e.message); }

  const isTest = d.form_type === 'test_booking' && url.searchParams.get('t') !== 'card';
  const type = isTest ? 'Test booking' : 'Card application';
  const val = (k) => (typeof d[k] === 'string' ? d[k].replace(/[\r\n]/g, ' ').trim().slice(0, 500) : '');
  const req_ = isTest ? ['full_name', 'dob', 'ni_number', 'email', 'confirm_email', 'mobile', 'street_address', 'city', 'postcode', 'test_type', 'test_centre', 'test_date']
    : ['full_name', 'email', 'confirm_email', 'mobile'];
  const miss = req_.filter((k) => val(k) === '');
  if (miss.length) return out(false, 'Missing required fields: ' + miss.join(', '), 400);
  if (!validEmail(val('email'))) return out(false, 'Please enter a valid email address.', 400);
  if (val('email').toLowerCase() !== val('confirm_email').toLowerCase()) return out(false, 'Email addresses do not match.', 400);

  const f = Object.fromEntries(MAPPED.map((k) => [k, val(k)]));
  const extra = {};
  for (const [k, v] of Object.entries(d))
    if (typeof v === 'string' && !MAPPED.includes(k) && !['form_type', ...Object.keys(FILE_FIELDS)].includes(k) && /^[a-z0-9_]+$/i.test(k)) extra[k] = v.slice(0, 500);

  const files = [], names = [];
  for (const k of Object.keys(FILE_FIELDS)) {
    let x = null; try { x = await takeFile(d[k]); } catch (e) { console.error('file:', e.message); }
    if (x) files.push({ label: FILE_FIELDS[k], ...x });
    names.push(x ? x.path : '');
  }

  let id = 0, saved = false;
  try {
    const row = must(await sb().from('bookings').insert({
      type, card_type: f.ecs_card_type, full_name: f.full_name, dob: f.dob, ni: f.ni_number, gender: f.gender,
      address: f.street_address, city: f.city, postcode: f.postcode, mobile: f.mobile, email: f.email,
      test_type: f.test_type, language: f.test_language, centre: f.test_centre, test_date: f.test_date, test_time: f.test_time,
      id_file: names[0], photo_file: names[1], file3: names[2], extra,
    }).select('id').single());
    id = row.id; saved = true;
  } catch (e) { console.error('receive save:', e.message); }

  const rows = Object.entries({ ...Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'confirm_email')), ...extra })
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `<tr><td style="padding:4px 8px;font-weight:600">${esc(k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))}</td><td style="padding:4px 8px">${esc(v)}</td></tr>`).join('');
  let total = 0;
  const attach = files.filter((x) => (total += x.buf.length) <= MAX_ATTACH_TOTAL).map((x) => ({ filename: `${x.label}.${x.ext}`, content: x.buf, contentType: x.mime }));
  const origin = url.origin;
  const html = `<h2>New ${type}${id ? ` (#${id})` : ''}</h2><table style="border-collapse:collapse">${rows}</table><p>${attach.length} of ${files.length} file(s) attached.<br>Manage it in the admin panel: ${origin}/admin/</p>`;
  const sent = await sendMail({ to: await notifyEmails(), subject: `New ${type} - ${f.full_name}`, html, attachments: attach, replyTo: f.email });
  await autoReply(f.email, f.full_name, type);
  return saved || sent ? out(true) : out(false, 'Could not save your booking. Please email booking@applyecscard.co.uk.', 500);
}

// =====================================================================
// PUBLIC: contact form (contact.html / index.html -> /admin/enquiry.php)
// =====================================================================
const page = (t, m, code = 200) => new Response(
  `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(t)}</title></head><body style="font-family:Arial,sans-serif;text-align:center;padding:60px 16px"><h2>${esc(t)}</h2><p>${esc(m)}</p><p><a href="/">Back to website</a></p></body></html>`,
  { status: code, headers: { 'content-type': 'text/html; charset=utf-8' } });

async function enquiry(req, ip) {
  let fd;
  const ct = req.headers.get('content-type') || '';
  try { fd = ct.includes('json') ? new Map(Object.entries(await req.json())) : await req.formData(); } catch { return page('Please check your details', 'Invalid form submission.', 400); }
  const v = (k, n = 3000) => (typeof fd.get(k) === 'string' ? fd.get(k).trim().slice(0, n) : '');
  const name = v('name', 200).replace(/[\r\n]/g, ' '), email = v('email', 200).replace(/[\r\n]/g, '');
  const phone = v('phone', 50).replace(/[\r\n]/g, ' '); let subject = v('subject', 200).replace(/[\r\n]/g, ' '); const message = v('message');
  if (!name || !message || !subject || !validEmail(email)) return page('Please check your details', 'Name, a valid email, subject and message are required. Please go back and try again.', 400);
  subject = { 'ecs-card': 'Apply for ECS Card', 'ecs-test': 'Book ECS Test', support: 'General Support' }[subject] || subject;
  try { if (await rateLimited('hits', 'e:' + ip, 10, 3600)) return page('Too many messages', 'Please try again later.', 429); } catch (e) { console.error(e.message); }
  // visitor id + cart snapshot sent by track.js (so the enquiry is linked to what the visitor added to cart)
  const vid = v('_vid', 40).replace(/[^A-Za-z0-9_-]/g, '');
  const cleanItem = (i) => ({ id: String(i?.id ?? '').slice(0, 100), name: String(i?.name ?? '').slice(0, 200), price: Math.max(0, Number(i?.price) || 0), qty: Math.max(1, Math.min(50, Number(i?.qty) || 1)) });
  let cart = [];
  try { const c = JSON.parse(v('_cart', 6000) || '[]'); if (Array.isArray(c)) cart = c.slice(0, 20).map(cleanItem).filter((i) => i.id || i.name); } catch { /* ignore */ }
  if (!cart.length && vid) { try { const { data } = await sb().from('live_visitors').select('cart').eq('vid', vid).maybeSingle(); if (Array.isArray(data?.cart)) cart = data.cart.slice(0, 20).map(cleanItem).filter((i) => i.id || i.name); } catch { /* ignore */ } }
  let saved = false;
  try { must(await sb().from('enquiries').insert({ name, email, phone, subject, message, cart, vid })); saved = true; }
  catch (e1) {
    console.error('enquiry save (with cart):', e1.message); // older table without cart/vid columns -> save the basics anyway
    try { must(await sb().from('enquiries').insert({ name, email, phone, subject, message: cart.length ? message + '\n\n[Cart: ' + cart.map((i) => i.name || i.id).join(', ') + ']' : message })); saved = true; } catch (e2) { console.error('enquiry save:', e2.message); }
  }
  if (vid) { try { await sb().from('cart_events').update({ name, email, phone }).eq('vid', vid).or('email.is.null,email.eq.'); } catch { /* column may not exist yet */ } }
  const cartHtml = cart.length ? `<h3>Cart (${cart.length})</h3><ul>${cart.map((i) => `<li>${esc(i.name || i.id)}${i.qty > 1 ? ' x' + i.qty : ''} - &pound;${i.price}</li>`).join('')}</ul><p><b>Cart total:</b> &pound;${cart.reduce((n, i) => n + i.price * i.qty, 0)}</p>` : '';
  const sent = await sendMail({
    to: await notifyEmails(), subject: `New enquiry - ${subject}${cart.length ? ' (+ cart)' : ''}`, replyTo: email,
    html: `<h2>New enquiry</h2><p><b>Name:</b> ${esc(name)}<br><b>Email:</b> ${esc(email)}<br><b>Phone:</b> ${esc(phone)}<br><b>Subject:</b> ${esc(subject)}</p><p>${esc(message).replace(/\n/g, '<br>')}</p>${cartHtml}<p>Manage: ${new URL(req.url).origin}/admin/#/enquiries</p>`,
  });
  if (!saved && !sent) return page('Sorry, something went wrong', 'We could not save your message. Please email booking@applyecscard.co.uk.', 500);
  await autoReply(email, name, 'enquiry');
  return page('Thank you!', 'Your message has been sent. We will get back to you shortly.');
}

// =====================================================================
// PUBLIC: "add to cart" + "checkout started" tracking (site/track.js) -> admin Cart tab + email
// =====================================================================
async function cartEvent(req, url, ip) {
  const ok = () => json({ ok: true });
  const d = await body(req);
  const s = (v, n = 200) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, n) : '');
  const kind = d.kind === 'checkout' ? 'checkout' : 'add_to_cart';
  const one = (i) => ({ id: s(i?.id, 100), name: s(i?.name, 200), price: Math.max(0, Number(i?.price) || 0), qty: Math.max(1, Math.min(50, Number(i?.qty) || 1)) });
  let items = Array.isArray(d.items) ? d.items.slice(0, 20).map(one) : [];
  if (!items.length && (d.id || d.name)) items = [one(d)];
  items = items.filter((i) => i.id || i.name);
  if (!items.length) return json({ ok: false }, 400);
  // add_to_cart: d.name is the COURSE name, not the person. Only a checkout carries the visitor's own name / phone.
  let name = kind === 'checkout' ? s(d.name) : '', phone = kind === 'checkout' ? s(d.phone, 50) : '', email = validEmail(s(d.email)) ? s(d.email) : '';
  const page = s(d.page, 200), vid = s(d.vid, 40).replace(/[^A-Za-z0-9_-]/g, '');
  // visitor already filled the contact form / typed details earlier? attach them to this cart event
  if (vid && !(name || email || phone)) {
    try {
      const { data: e1 } = await sb().from('enquiries').select('name,email,phone').eq('vid', vid).order('id', { ascending: false }).limit(1).maybeSingle();
      const { data: l1 } = e1 ? { data: null } : await sb().from('live_visitors').select('name,email,phone').eq('vid', vid).maybeSingle();
      const k = e1 || l1;
      if (k) { name = s(k.name); phone = s(k.phone, 50); email = validEmail(s(k.email)) ? s(k.email) : ''; }
    } catch (e) { console.error('cart enrich:', e.message); }
  }
  try {
    if (await rateLimited('hits', 'c:' + ip, 300, 3600)) return ok();
    const key = kind === 'checkout' ? `c:${ip}:co:${email}` : `c:${ip}:${items[0].id}`;
    if (await rateLimited('hits', key, 5, 3600)) return ok(); // same visitor, same thing: don't spam
  } catch (e) { console.error(e.message); }
  const total = items.reduce((a, i) => a + i.price * i.qty, 0);
  try { must(await sb().from('cart_events').insert({ kind, items, total, name, email, phone, page, ip, vid })); }
  catch (e1) {
    console.error('cart save (with vid):', e1.message); // older table without vid column
    try { must(await sb().from('cart_events').insert({ kind, items, total, name, email, phone, page, ip })); } catch (e2) { console.error('cart save:', e2.message); await logAction('cart_save_failed', e2.message, ip); }
  }
  const list = items.map((i) => `<li>${esc(i.name || i.id)}${i.qty > 1 ? ' x' + i.qty : ''} - &pound;${i.price}</li>`).join('');
  const who = (name || email || phone) ? `<p><b>Name:</b> ${esc(name)}<br><b>Email:</b> ${esc(email)}<br><b>Phone:</b> ${esc(phone)}</p>` : '<p>Visitor has not entered contact details yet.</p>';
  await sendMail({
    to: await notifyEmails(), replyTo: email,
    subject: kind === 'checkout' ? `Checkout started - ${name || email || 'visitor'} (£${total})` : `Added to cart - ${items[0].name || items[0].id}${name || email ? ' - ' + (name || email) : ''}`,
    html: `<h2>${kind === 'checkout' ? 'Customer started checkout' : 'Someone added a course to the cart'}</h2><ul>${list}</ul><p><b>Total:</b> &pound;${total}</p>${who}<p><b>Page:</b> ${esc(page)}<br><b>Time:</b> ${esc(new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' }))}</p><p>Admin panel: ${url.origin}/admin/#/cart</p>`,
  });
  return ok();
}

// =====================================================================
// EXTRA ADMIN FEATURES: dashboard, exports/backup, header-menu hiding, customer auto-reply
// =====================================================================
const AR_DEFAULT = { on: false, subject: 'We have received your request - Apply ECS', body: 'Dear {n},\n\nThank you for contacting Apply ECS. We have received your {type} and will get back to you shortly.\n\nKind regards,\nApply ECS\nbooking@applyecscard.co.uk' };
const autoreplyCfg = async () => ({ ...AR_DEFAULT, ...((await getSetting('autoreply', {})) || {}) });
async function autoReply(to, name, type) {
  try {
    const c = await autoreplyCfg();
    if (!c.on || !validEmail(to)) return;
    const t = String(type).toLowerCase();
    const fill = (x) => String(x).replace(/\{n\}/g, name || 'there').replace(/\{type\}/g, t);
    await sendMail({ to, subject: fill(c.subject), html: `<div style="font-family:Arial,sans-serif;white-space:pre-line">${esc(fill(c.body))}</div>`, replyTo: 'booking@applyecscard.co.uk' });
  } catch (e) { console.error('autoreply:', e.message); }
}
async function autoreplySave(req, ip) {
  const d = await body(req);
  await setSetting('autoreply', { on: !!d.on, subject: String(d.subject || AR_DEFAULT.subject).slice(0, 200), body: String(d.body || AR_DEFAULT.body).slice(0, 3000) });
  await logAction('autoreply', d.on ? 'on' : 'off', ip);
  return json({ ok: true, message: 'Saved.' });
}

function csvResponse(name, rows) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const cell = (v) => { let s = v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' } });
}
async function backup(ip) {
  const get = async (t, lim = 50000) => { try { return must(await sb().from(t).select('*').order('id', { ascending: false }).limit(lim)); } catch { return []; } };
  const data = { exported: new Date().toISOString(), bookings: await get('bookings'), enquiries: await get('enquiries'), cart_events: await get('cart_events'), log: await get('log', 2000) };
  await logAction('backup_download', '', ip);
  return new Response(JSON.stringify(data, null, 1), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="applyecs-backup-${data.exported.slice(0, 10)}.json"`, 'cache-control': 'no-store' } });
}
async function dashboard() {
  const now = Date.now(), since = (d) => new Date(now - d * 864e5).toISOString();
  const cnt = async (t, d, f) => { try { let q = sb().from(t).select('*', { count: 'exact', head: true }).gte('created', since(d)); if (f) q = f(q); return (await q).count || 0; } catch { return 0; } };
  const last = async (t, cols) => { try { return must(await sb().from(t).select(cols).order('id', { ascending: false }).limit(5)); } catch { return []; } };
  const add = (q) => q.eq('kind', 'add_to_cart'), co = (q) => q.eq('kind', 'checkout');
  let online = 0; try { online = (await sb().from('live_visitors').select('*', { count: 'exact', head: true }).gte('last_seen', new Date(now - 75000).toISOString())).count || 0; } catch { /* optional */ }
  return json({
    online,
    today: { bookings: await cnt('bookings', 1), enquiries: await cnt('enquiries', 1), adds: await cnt('cart_events', 1, add), checkouts: await cnt('cart_events', 1, co) },
    week: { bookings: await cnt('bookings', 7), enquiries: await cnt('enquiries', 7), adds: await cnt('cart_events', 7, add), checkouts: await cnt('cart_events', 7, co) },
    latest: { bookings: await last('bookings', 'id,created,full_name,type,status'), enquiries: await last('enquiries', 'id,created,name,subject'), cart: await last('cart_events', 'id,created,kind,items,name,email') },
  });
}

// header / footer: hide menu items (by link) and words/texts
const cleanList = (a, n, max) => [...new Set((Array.isArray(a) ? a : []).map((x) => String(x).replace(/\s+/g, ' ').trim().slice(0, n)).filter(Boolean))].slice(0, max);
async function menuSave(req, ip) {
  const d = await body(req);
  const v = { href: cleanList(d.href, 300, 400).filter((x) => /^[A-Za-z0-9_.\/:#?=&%-]+$/.test(x)), text: cleanList(d.text, 120, 100).map((x) => x.toLowerCase()), words: cleanList(d.words, 80, 60) };
  await setSetting('menu_hide', v);
  await logAction('menu_hide', `${v.href.length} links, ${v.text.length} texts, ${v.words.length} words`, ip);
  return json({ ok: true, message: 'Saved. Site par 10-20 second me update ho jayega.' });
}
async function hiddenPublic() {
  const h = { 'cache-control': 'public, max-age=0, must-revalidate', 'netlify-cdn-cache-control': 'public, s-maxage=10, stale-while-revalidate=30' };
  try { const v = await getSetting('menu_hide', {}); return json({ href: v.href || [], text: v.text || [], words: v.words || [] }, 200, h); } catch { return json({ href: [], text: [], words: [] }, 200, { 'cache-control': 'public, max-age=10' }); }
}

// =====================================================================
// LIVE visitor tracking (site/track.js heartbeat -> Admin > Live)
// =====================================================================
async function ping(req, ip, context) {
  const d = await body(req);
  const s = (v, n = 200) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, n) : '');
  const vid = s(d.vid, 40);
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(vid)) return json({ ok: false }, 400);
  const page = s(d.page), now = new Date().toISOString();
  const ua = req.headers.get('user-agent') || '';
  const device = /ipad|tablet/i.test(ua) ? 'Tablet' : /mobi|android|iphone/i.test(ua) ? 'Mobile' : 'Desktop';
  const geo = context?.geo || {};
  const cart = (Array.isArray(d.cart) ? d.cart : []).slice(0, 20).map((i) => ({ id: s(i?.id, 100), name: s(i?.name, 200), price: Math.max(0, Number(i?.price) || 0), qty: Math.max(1, Math.min(50, Number(i?.qty) || 1)) }));
  const email = validEmail(s(d.email)) ? s(d.email) : '';
  const activity = s(d.activity, 120), formInfo = {};
  for (const k of ['test', 'centre', 'date', 'card']) if (d.form && typeof d.form[k] === 'string' && d.form[k].trim()) formInfo[k] = s(d.form[k], 120);
  try {
    const { data: cur } = await sb().from('live_visitors').select('views,pages,first_seen,name,email,phone').eq('vid', vid).maybeSingle();
    let pages = Array.isArray(cur?.pages) ? cur.pages : [], views = cur?.views || 0;
    if (!pages.length || pages[pages.length - 1].p !== page) { pages = [...pages, { p: page, t: now }].slice(-25); views += 1; }
    const row = {
      vid, first_seen: cur?.first_seen || now, last_seen: now, page, title: s(d.title), ref: s(d.ref), device,
      city: s(geo.city, 80), country: s(geo.country?.name || geo.country?.code, 80), ip, views, pages, cart,
      name: s(d.name) || cur?.name || '', email: email || cur?.email || '', phone: s(d.phone, 50) || cur?.phone || '',
    };
    const up = await sb().from('live_visitors').upsert({ ...row, activity, form: formInfo });
    if (up.error) must(await sb().from('live_visitors').upsert(row)); // older table without activity/form columns
    if (Math.random() < 0.02) await sb().from('live_visitors').delete().lt('last_seen', new Date(Date.now() - 7 * 864e5).toISOString());
  } catch (e) { console.error('ping:', e.message); }
  return json({ ok: true });
}
async function liveList() {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const rows = must(await sb().from('live_visitors').select('*').gte('last_seen', since).order('last_seen', { ascending: false }).limit(200));
  // tell the admin which visitors are already customers (and what they booked)
  const emails = [...new Set(rows.map((r) => (r.email || '').toLowerCase()).filter(Boolean))];
  const known = {};
  if (emails.length) {
    try {
      for (const b of must(await sb().from('bookings').select('id,email,test_type,card_type,type,status').in('email', emails))) (known[b.email.toLowerCase()] ||= []).push({ id: b.id, test: b.test_type || b.card_type || b.type, status: b.status });
    } catch (e) { console.error('live known:', e.message); }
  }
  const blocked = new Set(((await getSetting('blocked_ips', []).catch(() => [])) || []).map((x) => x.ip));
  return json({ now: new Date().toISOString(), rows: rows.map((r) => ({ ...r, bookings: known[(r.email || '').toLowerCase()] || [], blocked: blocked.has(r.ip) })) });
}

// =====================================================================
// PUBLIC: design CSS
// =====================================================================
async function siteCss() {
  const h = { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate', 'netlify-cdn-cache-control': 'public, s-maxage=60, stale-while-revalidate=300' };
  try {
    const [design, hidden, deleted] = await Promise.all([getSetting('design', {}), getSetting('hidden', []), getSetting('deleted', [])]);
    const mh = await getSetting('menu_hide', {});
    const hv = (v) => { const b = v.replace(/^https?:\/\/[^/]+/i, '').replace(/^(\.\/|\/)+/, '').replace(/\.html$/i, ''); return [...new Set([v, b, b + '.html', '/' + b, '/' + b + '.html', './' + b + '.html'])]; };
    const hrefCss = (mh.href || []).filter((v) => /^[A-Za-z0-9_.\/:#?=&%-]+$/.test(v) && v !== '#' && v.length > 1).flatMap(hv).map((v) => `a[href="${v}"],li:has(>a[href="${v}"]){display:none!important}`).join('\n');
    return new Response(buildCss(design, [...new Set([...hidden, ...deleted])]) + '\n' + hrefCss, { headers: h });
  } catch (e) {
    console.error('site-css:', e.message);
    return new Response('/* design unavailable */', { headers: { 'content-type': 'text/css', 'cache-control': 'public, max-age=30' } });
  }
}

// =====================================================================
// AUTH / ACCOUNT / SETTINGS
// =====================================================================
async function login(req, ip) {
  const d = await body(req);
  if (await rateLimited('attempts', ip, 5, 900, { record: false })) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
  const c = await adminCreds();
  if (String(d.email || '').trim().toLowerCase() === c.email && checkPassword(d.password, c.hash)) {
    await logAction('login', '', ip);
    return json({ ok: true }, 200, { 'set-cookie': makeSessionCookie() });
  }
  await sb().from('attempts').insert({ ip });
  await logAction('login_failed', String(d.email || ''), ip);
  return json({ error: 'Wrong email or password.' }, 401);
}
async function accountSave(req, ip) {
  const d = await body(req), c = await adminCreds();
  const email = String(d.email || '').trim().toLowerCase(), nw = String(d.new || '');
  if (!checkPassword(d.current, c.hash)) return json({ error: 'Current password is wrong.' }, 400);
  if (!validEmail(email)) return json({ error: 'Enter a valid admin email.' }, 400);
  if (nw !== '' && nw.length < 10) return json({ error: 'New password must be at least 10 characters.' }, 400);
  if (nw !== String(d.new2 || '')) return json({ error: 'New passwords do not match.' }, 400);
  await setSetting('admin', { email, hash: nw ? hashPassword(nw) : c.hash });
  await logAction('account_changed', email, ip);
  return json({ ok: true, message: 'Saved. Use the new details next time you log in.' });
}
async function settingsSave(req, ip) {
  const d = await body(req);
  const list = String(d.notify || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((s) => !validEmail(s));
  if (bad.length) return json({ error: 'Invalid email: ' + bad.join(', ') }, 400);
  if (list.length > 5) return json({ error: 'Maximum 5 emails.' }, 400);
  await setSetting('notify', list.join(', '));
  await logAction('notify_emails', list.join(', '), ip);
  let message = 'Saved.';
  if (d.test) {
    const to = await notifyEmails();
    message += (await sendMail({ to, subject: 'Test email - Apply ECS admin', html: '<p>This is a test. Booking notifications will arrive at this address.</p>' }))
      ? ` Test email sent to ${to.join(', ')} (check spam too).` : ' Test email FAILED - check SMTP_* variables in Netlify.';
  }
  return json({ ok: true, message });
}

// =====================================================================
// BOOKINGS
// =====================================================================
async function counts() {
  const c = async (t) => (await sb().from(t).select('*', { count: 'exact', head: true }).eq('status', 'New')).count || 0;
  const lastId = async (t) => { try { return must(await sb().from(t).select('id').order('id', { ascending: false }).limit(1))[0]?.id || 0; } catch { return 0; } };
  let online = 0;
  try { online = (await sb().from('live_visitors').select('*', { count: 'exact', head: true }).gte('last_seen', new Date(Date.now() - 75 * 1000).toISOString())).count || 0; } catch { /* table optional */ }
  return json({ bookings: await c('bookings'), enquiries: await c('enquiries'), online, latest: { booking: await lastId('bookings'), enquiry: await lastId('enquiries'), cart: await lastId('cart_events') } });
}
const cleanQ = (q) => String(q || '').replace(/[,()%*\\]/g, ' ').trim();
async function bookingsQuery(url, limit) {
  const q = cleanQ(url.searchParams.get('q')), st = url.searchParams.get('status') || '';
  let b = sb().from('bookings').select('*').order('id', { ascending: false }).limit(limit);
  if (q) b = b.or(['full_name', 'email', 'mobile', 'ni'].map((c) => `${c}.ilike.%${q}%`).join(','));
  if (STATUSES.includes(st)) b = b.eq('status', st);
  return must(await b);
}
async function bookingsList(url) {
  const rows = await bookingsQuery(url, 500);
  const all = must(await sb().from('bookings').select('status').limit(20000));
  const counts = {}; for (const r of all) counts[r.status] = (counts[r.status] || 0) + 1;
  return json({ rows, counts, total: all.length });
}
async function bookingsCsv(url) {
  const rows = await bookingsQuery(url, 5000);
  const drop = ['id_file', 'photo_file', 'file3'];
  const cols = rows.length ? Object.keys(rows[0]).filter((k) => !drop.includes(k)) : [];
  const cell = (v) => { let s = v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="bookings.csv"', 'cache-control': 'no-store' } });
}
async function removeFiles(rows) {
  const paths = rows.flatMap((r) => [r.id_file, r.photo_file, r.file3]).filter((p) => p && /^docs\/[a-f0-9]+\.\w+$/.test(p));
  if (paths.length) await sb().storage.from(BUCKET).remove(paths);
}
async function bookingsBulk(req, ip) {
  const d = await body(req);
  const ids = [...new Set((Array.isArray(d.ids) ? d.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return json({ error: 'Nothing selected' }, 400);
  if (d.action === 'delete') {
    await removeFiles(must(await sb().from('bookings').select('id_file,photo_file,file3').in('id', ids)));
    must(await sb().from('bookings').delete().in('id', ids));
    await logAction('bulk_delete', ids.join(','), ip);
  } else if (STATUSES.includes(d.action)) {
    must(await sb().from('bookings').update({ status: d.action }).in('id', ids));
    await logAction('bulk_status', `${d.action}: ${ids.join(',')}`, ip);
  } else return json({ error: 'Bad action' }, 400);
  return json({ ok: true });
}
async function bookingGet(id) {
  const { data, error } = await sb().from('bookings').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? json(data) : json({ error: 'Not found' }, 404);
}
async function bookingSave(id, req, ip) {
  const d = await body(req);
  const status = STATUSES.includes(d.status) ? d.status : 'New';
  must(await sb().from('bookings').update({ status, notes: String(d.notes ?? '').slice(0, 10000) }).eq('id', id));
  await logAction('booking_status', `#${id} -> ${status}`, ip);
  return json({ ok: true });
}
async function bookingDelete(id, ip) {
  await removeFiles(must(await sb().from('bookings').select('id_file,photo_file,file3').eq('id', id)));
  must(await sb().from('bookings').delete().eq('id', id));
  await logAction('booking_deleted', `#${id}`, ip);
  return json({ ok: true });
}
async function bookingEmail(id, req, ip) {
  const d = await body(req);
  const { data: b } = await sb().from('bookings').select('email,notes').eq('id', id).maybeSingle();
  const subject = String(d.subject || '').trim(), text = String(d.body || '').trim();
  if (!b || !subject || !text) return json({ error: 'Fill subject and message.' }, 400);
  const ok = await sendMail({ to: b.email, subject, html: esc(text).replace(/\n/g, '<br>'), replyTo: (await notifyEmails())[0] });
  if (!ok) return json({ error: 'Email could not be sent (check SMTP_* variables in Netlify).' }, 502);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  must(await sb().from('bookings').update({ notes: `${b.notes || ''}\n[${stamp}] Emailed customer: ${subject}`.trim() }).eq('id', id));
  await logAction('email_customer', `#${id} ${subject}`, ip);
  return json({ ok: true });
}
async function fileRedirect(id, kind) {
  const { data } = await sb().from('bookings').select(kind).eq('id', id).maybeSingle();
  const path = data?.[kind];
  if (!path || !/^docs\/[a-f0-9]+\.\w+$/.test(path)) return json({ error: 'Not found' }, 404);
  const { data: s, error } = await sb().storage.from(BUCKET).createSignedUrl(path, 60);
  if (error) throw new Error(error.message);
  return new Response(null, { status: 302, headers: { location: s.signedUrl, 'cache-control': 'no-store' } });
}

// =====================================================================
// ENQUIRIES
// =====================================================================
async function enquiryAction(id, req, ip) {
  const d = await body(req);
  if (d.action === 'delete') { must(await sb().from('enquiries').delete().eq('id', id)); await logAction('enquiry_deleted', `#${id}`, ip); }
  else if (ENQ_STATUSES.includes(d.action)) { must(await sb().from('enquiries').update({ status: d.action }).eq('id', id)); await logAction('enquiry_status', `#${id} -> ${d.action}`, ip); }
  else return json({ error: 'Bad action' }, 400);
  return json({ ok: true });
}

// =====================================================================
// STATS
// =====================================================================
async function stats() {
  const rows = must(await sb().from('bookings').select('id,created,status,type,test_type,centre,test_date,test_time,full_name').order('id', { ascending: false }).limit(20000));
  const enq = (await sb().from('enquiries').select('*', { count: 'exact', head: true })).count || 0;
  const now = Date.now(), DAY = 864e5, total = rows.length;
  const since = (n) => rows.filter((r) => now - new Date(r.created).getTime() <= n * DAY).length;
  const paid = rows.filter((r) => ['Paid', 'Test Booked', 'Completed'].includes(r.status)).length;
  const days = {}; for (let i = 29; i >= 0; i--) days[londonDay(new Date(now - i * DAY))] = 0;
  for (const r of rows) { const k = londonDay(new Date(r.created)); if (k in days) days[k]++; }
  const top = (col) => { const c = {}; for (const r of rows) if (r[col]) c[r[col]] = (c[r[col]] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ k, n })); };
  const today = londonDay(new Date());
  const upcoming = rows.filter((r) => r.test_date >= today && !['Cancelled', 'Completed'].includes(r.status))
    .sort((a, b) => (a.test_date + (a.test_time || '')).localeCompare(b.test_date + (b.test_time || ''))).slice(0, 10);
  return json({ total, week: since(7), month: since(30), paidPct: total ? Math.round((paid / total) * 100) : 0, enquiries: enq, days, upcoming,
    lists: { 'By form': top('type'), 'Top test types': top('test_type'), 'Top test centres': top('centre'), 'By status': top('status') } });
}

// =====================================================================
// PAGES (hide / show / delete / restore) + DESIGN
// =====================================================================
async function pageIndex(url) {
  const r = await fetch(new URL('/admin/pages-index.json', url.origin));
  if (!r.ok) throw new Error('pages-index.json not found - redeploy the site so the build can create it');
  return r.json();
}
async function pagesList(url) {
  const [idx, hidden, deleted] = await Promise.all([pageIndex(url), getSetting('hidden', []), getSetting('deleted', [])]);
  return json(idx.map((p) => ({ ...p, state: deleted.includes(p.slug) ? 'deleted' : hidden.includes(p.slug) ? 'hidden' : 'visible' })));
}
async function pagesAction(req, url, ip) {
  const { action, slug } = await body(req);
  const known = (await pageIndex(url)).map((p) => p.slug);
  if (!validSlug(slug) || !known.includes(slug) || PROTECTED_PAGES.includes(slug)) return json({ error: 'Page not found or protected.' }, 400);
  let hidden = await getSetting('hidden', []), deleted = await getSetting('deleted', []);
  const del = (arr) => arr.filter((s) => s !== slug);
  if (action === 'hide') hidden = [...new Set([...hidden, slug])];
  else if (action === 'show') hidden = del(hidden);
  else if (action === 'delete') { deleted = [...new Set([...deleted, slug])]; hidden = del(hidden); }
  else if (action === 'restore') deleted = del(deleted);
  else return json({ error: 'Bad action' }, 400);
  await Promise.all([setSetting('hidden', hidden), setSetting('deleted', deleted)]);
  await logAction('pages_' + action, slug, ip);
  return json({ ok: true });
}
async function designSave(req, ip) {
  const d = await body(req);
  await setSetting('design', d.reset ? {} : sanitizeDesign(d.values || {}));
  await logAction(d.reset ? 'design_reset' : 'design_saved', '', ip);
  return json({ ok: true });
}

// =====================================================================
// BLOCKED IPs (spam shield): blocked visitors cannot submit forms / be tracked
// =====================================================================
let _blk = { t: 0, set: new Set() };
async function isBlocked(ip) {
  if (!ip) return false;
  if (Date.now() - _blk.t > 20000) {
    try { _blk = { t: Date.now(), set: new Set(((await getSetting('blocked_ips', [])) || []).map((x) => x.ip)) }; } catch { _blk.t = Date.now(); }
  }
  return _blk.set.has(ip);
}
async function blockedSave(req, ip) {
  const d = await body(req);
  const target = String(d.ip || '').trim();
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(target)) return json({ error: 'Enter a valid IP address.' }, 400);
  let list = (await getSetting('blocked_ips', [])) || [];
  if (d.action === 'remove') list = list.filter((x) => x.ip !== target);
  else if (d.action === 'add') {
    if (target === ip) return json({ error: 'That is your own IP address - you cannot block it.' }, 400);
    if (!list.some((x) => x.ip === target)) list = [{ ip: target, note: String(d.note || '').slice(0, 100), at: new Date().toISOString() }, ...list].slice(0, 300);
  } else return json({ error: 'Bad action' }, 400);
  await setSetting('blocked_ips', list);
  _blk.t = 0;
  await logAction('blocked_ip_' + d.action, target, ip);
  return json({ ok: true, list });
}

// =====================================================================
// CUSTOMERS: which user booked which test (bookings + enquiries + checkouts grouped by email / mobile)
// =====================================================================
const digits = (v) => String(v || '').replace(/\D/g, '');
const custKey = (email, mobile) => (validEmail(String(email || '').trim()) ? String(email).trim().toLowerCase() : digits(mobile).length >= 7 ? 'm:' + digits(mobile).slice(-10) : '');
const testLabel = (b) => b.test_type || b.card_type || b.type || '';
const optional = async (q, def = []) => { try { return must(await q); } catch (e) { console.error('optional:', e.message); return def; } };

async function loadPeople() {
  const [bk, en, ct] = await Promise.all([
    optional(sb().from('bookings').select('id,created,status,type,card_type,full_name,email,mobile,test_type,centre,test_date,test_time').order('id', { ascending: false }).limit(20000)),
    optional(sb().from('enquiries').select('id,created,status,name,email,phone,subject').order('id', { ascending: false }).limit(5000)),
    optional(sb().from('cart_events').select('id,created,kind,items,total,name,email,phone').order('id', { ascending: false }).limit(5000)),
  ]);
  return { bk, en, ct };
}
function groupPeople({ bk, en, ct }) {
  const map = new Map();
  const get = (key, name, email, mobile, at) => {
    let c = map.get(key);
    if (!c) { c = { key, name: '', email: '', mobile: '', bookings: [], enquiries: [], carts: [], first: at, last: at }; map.set(key, c); }
    c.name ||= name || ''; c.email ||= email || ''; c.mobile ||= mobile || '';
    if (at < c.first) c.first = at; if (at > c.last) c.last = at;
    return c;
  };
  for (const b of bk) { const k = custKey(b.email, b.mobile) || 'b:' + b.id; get(k, b.full_name, b.email, b.mobile, b.created).bookings.push({ id: b.id, created: b.created, type: b.type, test: testLabel(b), centre: b.centre, test_date: b.test_date, test_time: b.test_time, status: b.status }); }
  for (const e of en) { const k = custKey(e.email, e.phone); if (k) get(k, e.name, e.email, e.phone, e.created).enquiries.push({ id: e.id, created: e.created, subject: e.subject, status: e.status }); }
  for (const c of ct) { if (c.kind !== 'checkout') continue; const k = custKey(c.email, c.phone); if (k) get(k, c.name, c.email, c.phone, c.created).carts.push({ id: c.id, created: c.created, items: c.items, total: c.total }); }
  return map;
}
async function customersList() {
  const map = groupPeople(await loadPeople());
  const rows = [...map.values()].sort((a, b) => b.last.localeCompare(a.last)).slice(0, 3000);
  return json({ total: map.size, rows });
}
async function customerOne(url) {
  const key = String(url.searchParams.get('k') || '').toLowerCase();
  const c = groupPeople(await loadPeople()).get(key);
  if (!c) return json({ error: 'Customer not found' }, 404);
  let sessions = [];
  if (c.email) sessions = await optional(sb().from('live_visitors').select('vid,first_seen,last_seen,views,pages,device,city,country').eq('email', c.email).order('last_seen', { ascending: false }).limit(10));
  return json({ ...c, sessions });
}
async function customersCsv() {
  const map = groupPeople(await loadPeople());
  const rows = [];
  for (const c of map.values()) {
    if (!c.bookings.length) rows.push({ name: c.name, email: c.email, mobile: c.mobile, test_or_card: '', centre: '', test_date: '', status: '', enquiries: c.enquiries.length });
    for (const b of c.bookings) rows.push({ name: c.name, email: c.email, mobile: c.mobile, test_or_card: b.test, centre: b.centre, test_date: b.test_date, status: b.status, enquiries: c.enquiries.length });
  }
  return csvResponse('customers-and-tests.csv', rows);
}

// =====================================================================
// LEADS: people who showed interest (checkout / enquiry / live form) but have NOT booked yet
// =====================================================================
async function leadsList() {
  const { bk, en, ct } = await loadPeople();
  const live = await optional(sb().from('live_visitors').select('name,email,phone,cart,last_seen,page').neq('email', '').order('last_seen', { ascending: false }).limit(1000));
  const booked = new Set(bk.map((b) => custKey(b.email, b.mobile)).filter(Boolean));
  const done = new Set((await getSetting('leads_done', []).catch(() => [])) || []);
  const map = new Map();
  const add = (src, name, email, phone, at, info, total) => {
    const k = custKey(email, phone); if (!k || booked.has(k)) return;
    let l = map.get(k); if (!l) { l = { key: k, name: '', email: '', phone: '', last: at, sources: [], info: '', total: 0 }; map.set(k, l); }
    l.name ||= name || ''; l.email ||= email || ''; l.phone ||= phone || '';
    if (at > l.last) l.last = at;
    if (!l.sources.includes(src)) l.sources.push(src);
    if (info && !l.info) l.info = info;
    if (total && !l.total) l.total = total;
  };
  const itemText = (items) => (Array.isArray(items) ? items.map((i) => i.name || i.id).filter(Boolean).join(', ') : '');
  for (const c of ct) if (c.kind === 'checkout') add('Checkout', c.name, c.email, c.phone, c.created, itemText(c.items), c.total);
  for (const e of en) add('Enquiry', e.name, e.email, e.phone, e.created, e.subject);
  for (const v of live) add('Live visitor', v.name, v.email, v.phone, v.last_seen, itemText(v.cart) || v.page, (v.cart || []).reduce((n, i) => n + (i.price || 0) * (i.qty || 1), 0));
  const rows = [...map.values()].map((l) => ({ ...l, done: done.has(l.key) })).sort((a, b) => b.last.localeCompare(a.last));
  return json({ rows });
}
async function leadsMark(req, ip) {
  const d = await body(req);
  const key = String(d.key || '').slice(0, 200); if (!key) return json({ error: 'Bad request' }, 400);
  let list = (await getSetting('leads_done', [])) || [];
  list = d.done ? [...new Set([key, ...list])].slice(0, 3000) : list.filter((x) => x !== key);
  await setSetting('leads_done', list);
  await logAction('lead_' + (d.done ? 'done' : 'reopen'), key, ip);
  return json({ ok: true });
}

// =====================================================================
// GLOBAL SEARCH + REPORTS
// =====================================================================
async function searchAll(url) {
  const q = cleanQ(url.searchParams.get('q'));
  if (q.length < 2) return json({ bookings: [], enquiries: [], cart: [] });
  const or = (cols) => cols.map((c) => `${c}.ilike.%${q}%`).join(',');
  const [bookings, enquiries, cart] = await Promise.all([
    optional(sb().from('bookings').select('id,created,full_name,email,mobile,type,test_type,card_type,centre,test_date,status').or(or(['full_name', 'email', 'mobile', 'ni', 'test_type', 'centre'])).order('id', { ascending: false }).limit(50)),
    optional(sb().from('enquiries').select('id,created,name,email,phone,subject,status').or(or(['name', 'email', 'phone', 'subject', 'message'])).order('id', { ascending: false }).limit(50)),
    optional(sb().from('cart_events').select('id,created,kind,items,total,name,email,phone').or(or(['name', 'email', 'phone'])).order('id', { ascending: false }).limit(50)),
  ]);
  return json({ bookings, enquiries, cart });
}
function range(url) {
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const to = ok(url.searchParams.get('to')) ? url.searchParams.get('to') : londonDay(new Date());
  const from = ok(url.searchParams.get('from')) ? url.searchParams.get('from') : londonDay(new Date(Date.now() - 29 * 864e5));
  return { from, to, a: new Date(from + 'T00:00:00Z').toISOString(), b: new Date(new Date(to + 'T00:00:00Z').getTime() + 864e5).toISOString() };
}
const rangeRows = async (r) => must(await sb().from('bookings').select('id,created,status,type,card_type,full_name,email,mobile,test_type,centre,test_date,test_time').gte('created', r.a).lt('created', r.b).order('id', { ascending: false }).limit(20000));
async function reports(url) {
  const r = range(url), rows = await rangeRows(r);
  const group = (fn) => { const m = {}; for (const b of rows) { const k = fn(b) || '(not given)'; (m[k] ||= []).push({ id: b.id, name: b.full_name, email: b.email, mobile: b.mobile, centre: b.centre, test_date: b.test_date, status: b.status }); } return Object.entries(m).map(([k, list]) => ({ k, n: list.length, list })).sort((a, b) => b.n - a.n); };
  const days = {}; for (const b of rows) { const d = londonDay(new Date(b.created)); days[d] = (days[d] || 0) + 1; }
  const paid = rows.filter((b) => ['Paid', 'Test Booked', 'Completed'].includes(b.status)).length;
  return json({ from: r.from, to: r.to, total: rows.length, paid, byTest: group(testLabel), byCentre: group((b) => b.centre), byStatus: group((b) => b.status), days });
}
async function reportsCsv(url) {
  const r = range(url), rows = await rangeRows(r);
  return csvResponse(`report-${r.from}-to-${r.to}.csv`, rows.map((b) => ({ id: b.id, booked_on: b.created, name: b.full_name, email: b.email, mobile: b.mobile, form: b.type, test_or_card: testLabel(b), centre: b.centre, test_date: b.test_date, test_time: b.test_time, status: b.status })));
}

// =====================================================================
// BLOGS: public pages (only status = published) + admin management
// =====================================================================
const BLOG_HDR = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' };
const blogNotFound = () => new Response('<!DOCTYPE html><title>404</title><h1>404 - Page not found</h1><p><a href="/blog">Back to blog</a></p>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

async function blogPublicIndex(asSitemap) {
  let posts = [];
  try { posts = must(await sb().from('blogs').select('slug,title,excerpt,created,updated,published_at').eq('status', 'published').order('published_at', { ascending: false }).limit(500)); }
  catch (e) { console.error('blog index:', e.message); } // table missing -> show an empty blog page, never an error
  if (asSitemap) return new Response(sitemapXml(posts), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' } });
  return new Response(indexPage(posts), { headers: BLOG_HDR });
}
async function blogPublicPost(slug, req) {
  let post = null;
  try { const { data } = await sb().from('blogs').select('*').eq('slug', slug).maybeSingle(); post = data; } catch (e) { console.error('blog post:', e.message); }
  if (!post) return blogNotFound();
  if (post.status !== 'published') {
    if (!hasSession(req)) return blogNotFound(); // draft / hidden: ONLY the logged-in admin can preview
    return new Response(postPage(post, { preview: true }), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  return new Response(postPage(post), { headers: BLOG_HDR });
}

async function blogsList() {
  // first time only: add the 10 starter blogs as DRAFTS (nothing goes live by itself)
  try {
    if (!(await getSetting('blogs_seeded', false))) {
      const { count } = await sb().from('blogs').select('*', { count: 'exact', head: true });
      if (!count) must(await sb().from('blogs').upsert(BLOG_SEED.map((b) => ({ ...b, status: 'draft' })), { onConflict: 'slug', ignoreDuplicates: true }));
      await setSetting('blogs_seeded', true);
    }
  } catch (e) { console.error('blog seed:', e.message); }
  const rows = must(await sb().from('blogs').select('*').order('id', { ascending: false }).limit(500));
  return json(rows);
}
async function blogSave(id, req, ip) {
  const d = await body(req);
  const t = (v, n) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, n) : '');
  const row = {};
  if ('title' in d) { row.title = t(d.title, 200).replace(/\n/g, ' '); if (!row.title) return json({ error: 'Title is required' }, 400); }
  if ('excerpt' in d) row.excerpt = t(d.excerpt, 400).replace(/\n/g, ' ');
  if ('content' in d) row.content = t(d.content, 60000);
  if ('course_id' in d) row.course_id = t(d.course_id, 100).replace(/[^A-Za-z0-9_-]/g, '');
  if ('course_name' in d) row.course_name = t(d.course_name, 200).replace(/\n/g, ' ');
  if ('course_url' in d) row.course_url = safeCourseUrl(t(d.course_url, 200));
  if ('slug' in d) { row.slug = slugify(d.slug); if (!row.slug) return json({ error: 'Slug is required' }, 400); }
  if ('status' in d) { if (!BLOG_STATUSES.includes(d.status)) return json({ error: 'Bad status' }, 400); row.status = d.status; }
  row.updated = new Date().toISOString();
  if (!id) {
    if (!row.title) return json({ error: 'Title is required' }, 400);
    row.slug = row.slug || slugify(row.title) || 'post';
    row.status = row.status || 'draft'; // new posts are NEVER live until you publish them
  }
  if (row.status === 'published') {
    const cur = id ? (await sb().from('blogs').select('published_at').eq('id', id).maybeSingle()).data : null;
    if (!cur?.published_at) row.published_at = row.updated; // keep the first publish date
  }
  // unique slug
  if (row.slug) {
    let base = row.slug, n = 1;
    for (;;) {
      const q = sb().from('blogs').select('id').eq('slug', row.slug); const { data } = await (id ? q.neq('id', id) : q).maybeSingle();
      if (!data) break; n += 1; row.slug = `${base}-${n}`.slice(0, 90);
    }
  }
  const out = id ? must(await sb().from('blogs').update(row).eq('id', id).select('*').single()) : must(await sb().from('blogs').insert(row).select('*').single());
  await logAction(id ? 'blog_updated' : 'blog_created', `#${out.id} ${out.title} [${out.status}]`, ip);
  return json(out);
}
async function blogDelete(id, ip) {
  must(await sb().from('blogs').delete().eq('id', id));
  await logAction('blog_deleted', `#${id}`, ip);
  return json({ ok: true });
}

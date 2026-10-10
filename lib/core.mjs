// Shared helpers for all Vercel Functions: Supabase, sessions, settings, mail, logging.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';

export const BUCKET = 'documents';
export const STATUSES = ['New', 'Contacted', 'Paid', 'Test Booked', 'Completed', 'Cancelled'];
export const ENQ_STATUSES = ['New', 'Replied', 'Closed'];
export const PROTECTED_PAGES = ['index', 'header', 'footer'];
// Fallbacks = your old PHP panel login, so the same password works on first login. Change it in Admin > Account.
const DEFAULT_EMAIL = 'booking@applyecscard.co.uk';
// Every booking / enquiry / cart / checkout notification ALWAYS goes to these addresses (plus any extra set in Admin > Settings)
const ALWAYS_NOTIFY = [DEFAULT_EMAIL, 'applyecs4@gmail.com'];
const DEFAULT_HASH = '$2y$10$0BymR7MhzvS0v4LO1AKMa.udsMluuX3pA.LTI5iWVALsEbtlLp8pm';

// ---------- responses ----------
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const validSlug = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s);
export const validEmail = (s) => typeof s === 'string' && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s) && s.length <= 254;

// ---------- supabase ----------
let _sb;
export function sb() {
  if (!_sb) {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set in Vercel environment variables');
    _sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _sb;
}
export function must({ data, error }) { if (error) throw new Error(error.message); return data; }

export async function getSetting(key, def) {
  const { data, error } = await sb().from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? data.value : def;
}
export async function setSetting(key, value) { must(await sb().from('settings').upsert({ key, value })); }

export function clientIp(req, context) {
  const h = (n) => (req.headers.get(n) || '').split(',')[0].trim();
  return context?.ip || h('x-real-ip') || h('x-vercel-forwarded-for') || h('x-forwarded-for') || '';
}
// Visitor location from Vercel's edge headers (city is URL-encoded)
export function geoFrom(req, context) {
  if (context?.geo) return { city: context.geo.city || '', country: context.geo.country?.name || context.geo.country?.code || '' };
  let city = req.headers.get('x-vercel-ip-city') || '';
  try { city = decodeURIComponent(city); } catch { /* keep raw */ }
  return { city, country: req.headers.get('x-vercel-ip-country') || '' };
}
export async function logAction(action, detail = '', ip = '') {
  try { await sb().from('log').insert({ ip, action, detail: String(detail).slice(0, 300) }); } catch { /* never break the request */ }
}
// returns true if the caller is over the limit; otherwise records this hit
export async function rateLimited(table, ip, max, windowSec, { record = true } = {}) {
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  await sb().from(table).delete().lt('ts', since);
  const { count } = await sb().from(table).select('*', { count: 'exact', head: true }).eq('ip', ip).gte('ts', since);
  if ((count || 0) >= max) return true;
  if (record) await sb().from(table).insert({ ip });
  return false;
}

// ---------- admin credentials ----------
export async function adminCreds() {
  const o = (await getSetting('admin', null)) || {};
  return { email: String(o.email || process.env.ADMIN_EMAIL || DEFAULT_EMAIL).toLowerCase(), hash: o.hash || process.env.ADMIN_PASSWORD_HASH || DEFAULT_HASH };
}
export const checkPassword = (plain, hash) => { try { return bcrypt.compareSync(String(plain || ''), hash); } catch { return false; } };
export const hashPassword = (plain) => bcrypt.hashSync(plain, 10);

// ---------- stateless signed session cookie ----------
const COOKIE = 'admin_session';
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET missing or too short (min 16 chars) in Vercel environment variables');
  return s;
}
const hmac = (body) => crypto.createHmac('sha256', secret()).update(body).digest('base64url');
export function makeSessionCookie(maxAgeSec = 12 * 3600) {
  const body = Buffer.from(JSON.stringify({ a: 1, exp: Math.floor(Date.now() / 1000) + maxAgeSec })).toString('base64url');
  return `${COOKIE}=${body}.${hmac(body)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
}
export const clearSessionCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
export function hasSession(req) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [body, sig] = m[1].split('.');
  if (!body || !sig) return false;
  const good = hmac(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now() / 1000; } catch { return false; }
}
// Returns a Response if NOT allowed, otherwise null.
export function guard(req) {
  if (!hasSession(req)) return json({ error: 'Not logged in' }, 401);
  if (!['GET', 'HEAD'].includes(req.method) && req.headers.get('x-requested-with') !== 'admin-panel') return json({ error: 'Bad request' }, 400);
  return null;
}

// ---------- mail (SMTP) ----------
let _tx;
export const mailConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
export async function notifyEmails() {
  const n = String((await getSetting('notify', '')) || '');
  const l = n.split(/[,;\s]+/).map((x) => x.trim()).filter(validEmail);
  // booking@applyecscard.co.uk and applyecs4@gmail.com always receive every notification, plus any extra addresses set in Admin > Settings
  return [...new Set([...ALWAYS_NOTIFY, ...l.map((x) => x.toLowerCase())])];
}
// attachments: [{filename, content(Buffer), contentType}]
export async function sendMail({ to, subject, html, attachments = [], replyTo }) {
  if (!mailConfigured()) { console.error('SMTP not configured - email skipped'); await logAction('mail_failed', 'SMTP not configured in Vercel env: ' + String(subject)); return false; }
  try {
    _tx ??= nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const rt = String(replyTo || '').replace(/[\r\n]/g, '');
    await _tx.sendMail({
      from: process.env.MAIL_FROM || `Apply ECS <${process.env.SMTP_USER}>`,
      to: Array.isArray(to) ? to.join(',') : to, subject: String(subject).replace(/[\r\n]/g, ' '), html, attachments,
      ...(validEmail(rt) ? { replyTo: rt } : {}),
    });
    return true;
  } catch (e) { console.error('sendMail failed:', e.message); await logAction('mail_failed', String(subject) + ' :: ' + e.message); return false; }
}

// ---------- documents ----------
export function sniffFile(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '\x89PNG') return { ext: 'png', mime: 'image/png' };
  if (buf.length > 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return { ext: 'pdf', mime: 'application/pdf' };
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}
export const INCOMING_RE = /^incoming\/[a-f0-9]{24}\.(jpg|png|pdf|webp)$/;

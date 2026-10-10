// Offline smoke test: fake Supabase REST server + real function code.
import http from 'node:http';
import bcrypt from 'bcryptjs';
import assert from 'node:assert/strict';

const srv = http.createServer((q, r) => {
  const obj = /vnd\.pgrst\.object/.test(q.headers.accept || '');
  if (q.method === 'GET' || q.method === 'HEAD') {
    if (obj) { r.writeHead(406, { 'content-type': 'application/json' }); return r.end(JSON.stringify({ code: 'PGRST116', message: 'no rows', details: '0 rows' })); }
    r.writeHead(200, { 'content-type': 'application/json', 'content-range': '*/0' }); return r.end(q.method === 'HEAD' ? '' : '[]');
  }
  q.resume(); r.writeHead(204, { 'content-range': '*/*' }); r.end();
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
process.env.SUPABASE_URL = `http://127.0.0.1:${srv.address().port}`;
process.env.SUPABASE_SERVICE_KEY = 'fake';
process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('test-pass-123', 4);

const { handler: api } = await import('../api/admin-api.mjs');
const { buildCss, sanitizeDesign } = await import('../lib/design.mjs');
const { sniffFile, INCOMING_RE, notifyEmails } = await import('../lib/core.mjs');
const call = (path, { method = 'GET', body, headers = {} } = {}) =>
  api(new Request('https://x.test' + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), { ip: '1.2.3.4' });

// guard
assert.equal((await call('/admin-api/bookings')).status, 401);
// bad login / good login
assert.equal((await call('/admin-api/login', { method: 'POST', body: { email: 'booking@applyecscard.co.uk', password: 'nope' } })).status, 401);
const ok = await call('/admin-api/login', { method: 'POST', body: { email: 'Booking@applyecscard.co.uk', password: 'test-pass-123' } });
assert.equal(ok.status, 200);
const cookie = ok.headers.get('set-cookie').split(';')[0];
assert.match(ok.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
const auth = { cookie, 'x-requested-with': 'admin-panel' };
assert.equal((await call('/admin-api/me', { headers: { cookie } })).status, 200);
assert.equal((await call('/admin-api/me', { headers: { cookie: cookie.slice(0, -2) + 'zz' } })).status, 401, 'tampered cookie must fail');
// admin reads
assert.equal((await call('/admin-api/bookings', { headers: auth })).status, 200);
assert.equal((await call('/admin-api/stats', { headers: auth })).status, 200);
assert.equal((await call('/admin-api/bookings.csv', { headers: auth })).headers.get('content-type').startsWith('text/csv'), true);
// CSRF-style: mutating request without the custom header is refused even with a valid cookie
assert.equal((await call('/admin-api/design', { method: 'POST', body: { reset: true }, headers: { cookie } })).status, 400);
assert.equal((await call('/admin-api/design', { method: 'POST', body: { reset: true }, headers: auth })).status, 200);
// public: site css + validation errors
const css = await call('/admin-api/site-css');
assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /text\/css/);
const rc = await call('/admin-api/receive', { method: 'POST', body: { form_type: 'test_booking', full_name: 'A' } });
assert.equal(rc.status, 400); assert.match((await rc.json()).error, /Missing required/);
assert.equal((await call('/admin-api/upload-url', { method: 'POST', body: { name: 'evil.exe', size: 10 } })).status, 400);
// cart tracking: public endpoint accepts events, rejects empty, admin can list; notify list always has booking@
assert.equal((await call('/admin-api/cart-event', { method: 'POST', body: { kind: 'add_to_cart', id: 'x', name: 'Test card', price: 79 } })).status, 200);
assert.equal((await call('/admin-api/cart-event', { method: 'POST', body: { kind: 'checkout', items: [{ id: 'x', name: 'Test card', price: 79, qty: 1 }], name: 'A B', email: 'a@b.co', phone: '0123456789' } })).status, 200);
assert.equal((await call('/admin-api/cart-event', { method: 'POST', body: { kind: 'add_to_cart' } })).status, 400);
assert.equal((await call('/admin-api/cart', { headers: auth })).status, 200);
assert.equal((await call('/admin-api/cart')).status, 401);
assert.ok((await notifyEmails()).includes('booking@applyecscard.co.uk'));
// new admin features
for (const x of ['/dashboard', '/upcoming', '/menu', '/export/enquiries.csv', '/export/cart.csv', '/backup.json']) assert.equal((await call('/admin-api' + x, { headers: auth })).status, 200, x);
assert.equal((await call('/admin-api/dashboard')).status, 401);
const mn = await call('/admin-api/menu', { method: 'POST', headers: auth, body: { href: ['book.html', 'bad"href'], text: ['Group Book'], words: ['SAVE'] } });
assert.equal(mn.status, 200);
assert.equal((await call('/admin-api/hidden')).status, 200);
assert.equal((await call('/admin-api/autoreply', { method: 'POST', headers: auth, body: { on: true, subject: 's', body: 'b {n}' } })).status, 200);
// live tracking
assert.equal((await call('/admin-api/ping', { method: 'POST', body: { vid: 'abcdefgh12345678', page: '/courses.html', title: 'Courses', cart: [{ id: 'x', name: 'T', price: 5, qty: 1 }], name: 'A B', email: 'a@b.co' } })).status, 200);
assert.equal((await call('/admin-api/ping', { method: 'POST', body: { vid: '!' } })).status, 400);
assert.equal((await call('/admin-api/live', { headers: auth })).status, 200);
assert.equal((await call('/admin-api/live')).status, 401);
// ---- v2: enquiry GET no longer "Method Not Allowed", customers / leads / search / reports / blocked IPs ----
const g = await call('/admin-api/enquiry'); assert.equal(g.status, 303); assert.equal(g.headers.get('location'), '/contact.html');
const fdBody = new URLSearchParams({ name: 'Test User', email: 'tu@example.com', phone: '0123456789', subject: 'ecs-test', message: 'Hello' });
const enqRes = await api(new Request('https://x.test/admin-api/enquiry', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: fdBody }), { ip: '9.9.9.9' });
assert.equal(enqRes.status, 200); assert.match(await enqRes.text(), /Thank you/);
const badEnq = await api(new Request('https://x.test/admin-api/enquiry', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name: 'x' }) }), { ip: '9.9.9.9' });
assert.equal(badEnq.status, 400);
for (const x of ['/customers', '/customers.csv', '/leads', '/search?q=john', '/reports', '/reports?from=2026-01-01&to=2026-02-01', '/reports.csv', '/blocked', '/counts', '/customer?k=a%40b.co']) {
  const r = await call('/admin-api' + x, { headers: auth }); assert.ok([200, 404].includes(r.status), x + ' -> ' + r.status);
  assert.equal((await call('/admin-api' + x)).status, 401, x + ' must need login');
}
assert.equal((await (await call('/admin-api/counts', { headers: auth })).json()).latest !== undefined, true);
assert.equal((await call('/admin-api/blocked', { method: 'POST', headers: auth, body: { action: 'add', ip: 'not an ip!' } })).status, 400);
assert.equal((await call('/admin-api/blocked', { method: 'POST', headers: auth, body: { action: 'add', ip: '1.2.3.4' } })).status, 400, 'cannot block yourself');
assert.equal((await call('/admin-api/blocked', { method: 'POST', headers: auth, body: { action: 'add', ip: '5.6.7.8' } })).status, 200);
assert.equal((await call('/admin-api/leads', { method: 'POST', headers: auth, body: { key: 'a@b.co', done: true } })).status, 200);
const hid = await (await call('/admin-api/hidden')).json(); assert.ok(Array.isArray(hid.href) && Array.isArray(hid.text) && Array.isArray(hid.words));
assert.equal((await call('/admin-api/ping', { method: 'POST', body: { vid: 'abcdefgh12345678', page: '/book.html', activity: 'Filling booking form', form: { test: 'Electrician', centre: 'Derby' } } })).status, 200);
// pure helpers
const out = buildCss(sanitizeDesign({ primary: '#112233', btn_r: '999', banner: '<b>Sale "now"</b>', font: 'Poppins' }), ['about', 'bad slug!']);
assert.match(out, /--primary:#112233/); assert.match(out, /border-radius:50px/); assert.match(out, /content:"Sale \\"now\\""/);
assert.match(out, /a\[href="about\.html"\]/); assert.ok(!out.includes('bad slug'));
assert.equal(sniffFile(Buffer.from('%PDF-1.4 ....')).ext, 'pdf'); assert.equal(sniffFile(Buffer.from('MZ....exe....')), null);
assert.ok(INCOMING_RE.test('incoming/' + 'a'.repeat(24) + '.jpg')); assert.ok(!INCOMING_RE.test('incoming/../../x.jpg'));
console.log('ALL SMOKE TESTS PASSED'); srv.close(); process.exit(0);

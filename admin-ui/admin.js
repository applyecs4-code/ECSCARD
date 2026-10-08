'use strict';
const $app = document.getElementById('app'), $nav = document.getElementById('nav');
const STATUSES = ['New', 'Contacted', 'Paid', 'Test Booked', 'Completed', 'Cancelled'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/London' }) : '');
const msgBox = (m, bad) => (m ? `<p class="${bad ? 'err' : 'ok'}">${esc(m)}</p>` : '');
let flash = '';
let blogEdit = null; // null = list, 0 = new post, number = editing that id
const waLink = (m) => { let d = String(m || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = '44' + d.slice(1); return d.length >= 8 ? 'https://wa.me/' + d : ''; };
const custKey = (email, mobile) => (/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(email || '').trim()) ? String(email).trim().toLowerCase() : String(mobile || '').replace(/\D/g, '').length >= 7 ? 'm:' + String(mobile).replace(/\D/g, '').slice(-10) : '');
const quick = (mobile, email) => [waLink(mobile) ? `<a class="btn" style="background:#25d366" target="_blank" rel="noopener" href="${waLink(mobile)}">WhatsApp</a>` : '', mobile ? `<a class="btn" href="tel:${esc(mobile)}">Call</a>` : '', email ? `<a class="btn" href="mailto:${esc(email)}">Email</a>` : ''].join(' ');


async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/admin-api' + path, {
    method, credentials: 'same-origin',
    headers: { 'x-requested-with': 'admin-panel', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && path !== '/login') { showLogin(); throw new Error('login'); }
  let data = {}; try { data = await r.json(); } catch (_) {}
  if (!r.ok) throw new Error(data.error || 'Request failed (' + r.status + ')');
  return data;
}
const SETUP_RE = /schema cache|Could not find the table|does not exist/i;
const fail = (e) => {
  if (e.message === 'login') return;
  if (!SETUP_RE.test(e.message)) return $app.insertAdjacentHTML('afterbegin', msgBox(e.message, true));
  // a database table is missing: show the one-click fix instead of a raw error
  $app.innerHTML = `<div class="card"><h3>Database setup is incomplete</h3><p class="err">${esc(e.message)}</p>
  <ol><li>Click <b>Copy SQL</b> below.</li><li>Open Supabase &rarr; <b>SQL Editor</b> &rarr; <b>New query</b> &rarr; paste &rarr; <b>Run</b>.</li><li>Come back here and refresh the page.</li></ol>
  <p><button id="cs">Copy SQL</button> <span id="cm"></span></p><textarea id="sq" class="full" rows="10" readonly></textarea></div>`;
  fetch('/admin-api/setup-sql', { credentials: 'same-origin' }).then((r) => r.text()).then((t) => {
    const ta = document.getElementById('sq'); if (!ta) return; ta.value = t;
    document.getElementById('cs').onclick = async () => { ta.select(); try { await navigator.clipboard.writeText(t); } catch (_) { document.execCommand('copy'); } document.getElementById('cm').textContent = 'Copied - now paste it into the Supabase SQL Editor and click Run.'; };
  });
};
const form = (el) => Object.fromEntries(new FormData(el).entries());

// ---------- shell ----------
function showLogin(err) {
  $nav.innerHTML = ''; stopAlerts();
  $app.innerHTML = `<div class="card" style="max-width:360px;margin:60px auto"><h2>Admin Login</h2>${msgBox(err, true)}
  <form id="lf"><p><input class="full" type="email" name="email" placeholder="Email" required></p>
  <p><input class="full" type="password" name="password" placeholder="Password" required></p><button class="full">Login</button></form></div>`;
  document.getElementById('lf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/login', { method: 'POST', body: form(e.target) }); location.hash = '#/bookings'; route(); }
    catch (x) { showLogin(x.message); }
  };
}
const NAV = [['home', 'Home'], ['live', 'Live'], ['bookings', 'Bookings'], ['customers', 'Customers'], ['enquiries', 'Enquiries'], ['blogs', 'Blogs'], ['cart', 'Cart'], ['leads', 'Leads'], ['upcoming', 'Upcoming tests'], ['reports', 'Reports'], ['header', 'Header'], ['pages', 'Pages'], ['design', 'Design'], ['stats', 'Stats'], ['settings', 'Settings'], ['account', 'Account'], ['log', 'Log']];
let navData = { bookings: 0, enquiries: 0, online: 0 };
function drawNav() {
  const cur = (location.hash || '#/home').split('/')[1].split('?')[0], b = (n) => (n ? `<span class="badge">${n}</span>` : '');
  const extra = { bookings: b(navData.bookings), enquiries: b(navData.enquiries), live: `<span id="livedot" style="color:#2ecc71">&#9679;</span> ${navData.online ? '<span class="badge" style="background:#2ecc71">' + navData.online + '</span>' : ''}` };
  $nav.innerHTML = NAV.map(([k, l]) => `<a href="#/${k}" class="${cur === k || (k === 'customers' && cur === 'customer') ? 'on' : ''}">${l} ${extra[k] || ''}</a>`).join('')
    + `<form id="gs" style="display:inline"><input id="gq" placeholder="Search name / email / phone" style="padding:5px;width:170px;margin-left:12px"></form> <a id="bell" title="Sound + popup alert for new booking / enquiry / checkout">${alertsOn() ? '&#128276; Alerts ON' : '&#128277; Alerts OFF'}</a><a id="lo">Logout</a>`;
  document.getElementById('lo').onclick = async () => { await fetch('/admin-api/logout', { method: 'POST', headers: { 'x-requested-with': 'admin-panel' } }); stopAlerts(); showLogin(); };
  document.getElementById('gs').onsubmit = (e) => { e.preventDefault(); const q = document.getElementById('gq').value.trim(); if (q) location.hash = '#/search?' + new URLSearchParams({ q }); };
  document.getElementById('bell').onclick = () => { localStorage.setItem('alerts_on', alertsOn() ? '0' : '1'); if (alertsOn()) { beep(); try { Notification.requestPermission(); } catch (_) {} } drawNav(); };
}
async function nav() {
  try { const c = await api('/counts'); navData = { bookings: c.bookings, enquiries: c.enquiries, online: c.online || 0 }; } catch (_) {}
  drawNav();
}

// ---------- alerts: sound + popup + tab title when something new arrives ----------
const alertsOn = () => localStorage.getItem('alerts_on') !== '0';
let audioCtx, alertTimer = null, seen = null, unread = 0;
function beep() { try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.connect(g); g.connect(audioCtx.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.15, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5); o.start(); o.stop(audioCtx.currentTime + 0.5); } catch (_) {} }
function stopAlerts() { clearInterval(alertTimer); alertTimer = null; seen = null; }
function startAlerts() {
  if (alertTimer) return;
  const tick = async () => {
    let c; try { c = await api('/counts'); } catch (_) { return; }
    navData = { bookings: c.bookings, enquiries: c.enquiries, online: c.online || 0 }; drawNav();
    const l = c.latest || {};
    if (seen) {
      const msgs = [];
      if (l.booking > seen.booking) msgs.push('New booking');
      if (l.enquiry > seen.enquiry) msgs.push('New enquiry');
      if (l.cart > seen.cart) msgs.push('New cart / checkout activity');
      if (msgs.length && alertsOn()) {
        beep(); unread += msgs.length; document.title = `(${unread}) ${msgs[0]} - Apply ECS Admin`;
        try { if (Notification.permission === 'granted') new Notification('Apply ECS', { body: msgs.join(', ') }); } catch (_) {}
      }
    }
    seen = { booking: l.booking || 0, enquiry: l.enquiry || 0, cart: l.cart || 0 };
  };
  tick(); alertTimer = setInterval(tick, 20000);
  window.addEventListener('focus', () => { unread = 0; document.title = 'Apply ECS – Admin'; });
}
async function route() {
  const [, name, arg] = (location.hash || '#/home').split('/');
  if (name.split('?')[0] !== 'blogs') blogEdit = null;
  const views = { live: viewLive, home: viewHome, upcoming: viewUpcoming, header: viewHeader, bookings: viewBookings, booking: viewBooking, enquiries: viewEnquiries, blogs: viewBlogs, cart: viewCart, stats: viewStats, pages: viewPages, design: viewDesign, settings: viewSettings, account: viewAccount, log: viewLog, customers: viewCustomers, customer: viewCustomer, leads: viewLeads, reports: viewReports, search: viewSearch };
  try { await api('/me'); } catch (e) { if (e.message !== 'login') $app.innerHTML = '<p class="err">Admin API error: ' + esc(e.message) + ' - check the terminal (netlify dev) for the error.</p>'; return; }
  if (window.__live) { clearInterval(window.__live); window.__live = null; }
  drawNav(); nav(); startAlerts(); $app.innerHTML = 'Loading…';
  try { await (views[name.split('?')[0]] || viewHome)(arg); } catch (e) { fail(e); }
}
window.addEventListener('hashchange', route);

// ---------- bookings ----------
async function viewBookings() {
  const hq = new URLSearchParams(location.hash.split('?')[1] || ''), q = hq.get('q') || '', st = hq.get('status') || '';
  const d = await api('/bookings?' + new URLSearchParams({ q, status: st }));
  $app.innerHTML = `${msgBox(flash)}<div class="stats"><div class="stat"><b>${d.total}</b>Total</div>${STATUSES.map((x) => `<div class="stat"><b>${d.counts[x] || 0}</b>${x}</div>`).join('')}</div><br>
  <div class="card"><form id="ff"><input name="q" value="${esc(q)}" placeholder="Search name / email / mobile / NI"> <select name="status"><option value="">All statuses</option>${STATUSES.map((x) => `<option${x === st ? ' selected' : ''}>${x}</option>`).join('')}</select>
  <button>Filter</button> <a class="btn" href="/admin-api/bookings.csv?${new URLSearchParams({ q, status: st })}">Export CSV</a></form></div>
  <div class="card wrap"><p><select id="bulk">${STATUSES.map((x) => `<option value="${x}">Set status: ${x}</option>`).join('')}<option value="delete">Delete selected</option></select> <button id="apply">Apply to ticked</button></p>
  <table><tr><th><input type="checkbox" id="all"></th><th>#</th><th>Date</th><th>Name</th><th>Type / Test</th><th>Centre</th><th>Test date</th><th>Mobile</th><th>Status</th><th></th></tr>
  ${d.rows.map((r) => `<tr><td><input class="cb" type="checkbox" value="${r.id}"></td><td>${r.id}</td><td>${esc(fmt(r.created))}</td><td>${esc(r.full_name)}<br><small>${esc(r.email)}</small></td><td>${esc(r.test_type || r.type)}</td><td>${esc(r.centre)}</td><td>${esc(((r.test_date || '') + ' ' + (r.test_time || '')).trim())}</td><td>${esc(r.mobile)}</td><td><span class="tag">${esc(r.status)}</span></td><td><a class="btn" href="#/booking/${r.id}">Open</a></td></tr>`).join('') || '<tr><td colspan="10">No bookings yet.</td></tr>'}</table></div>`;
  flash = '';
  document.getElementById('ff').onsubmit = (e) => { e.preventDefault(); location.hash = '#/bookings?' + new URLSearchParams(form(e.target)); };
  document.getElementById('all').onclick = (e) => document.querySelectorAll('.cb').forEach((c) => (c.checked = e.target.checked));
  document.getElementById('apply').onclick = async () => {
    const ids = [...document.querySelectorAll('.cb:checked')].map((c) => +c.value), action = document.getElementById('bulk').value;
    if (!ids.length) return;
    if (action === 'delete' && !confirm('Delete selected bookings and their documents permanently?')) return;
    try { await api('/bookings/bulk', { method: 'POST', body: { ids, action } }); route(); } catch (e) { fail(e); }
  };
}
const LABELS = { type: 'Form', created: 'Submitted', card_type: 'Application type', full_name: 'Full name', dob: 'Date of birth', ni: 'NI number', gender: 'Gender', address: 'Address', city: 'Town / city', postcode: 'Postcode', mobile: 'Mobile', email: 'Email', test_type: 'Test type', language: 'Language', centre: 'Test centre', test_date: 'Preferred date', test_time: 'Preferred time' };
const TPL = {
  received: ['Your booking request - Apply ECS', 'Dear {n},\n\nThank you for your booking request. We have received your details and are processing them. We will contact you shortly to confirm the next steps.\n\nKind regards,\nApply ECS'],
  docs: ['Documents needed for your booking - Apply ECS', 'Dear {n},\n\nTo continue with your booking we need a clear copy of your photo ID and a passport-style photo. Please reply to this email with them attached.\n\nKind regards,\nApply ECS'],
  pay: ['Payment reminder for your booking - Apply ECS', 'Dear {n},\n\nWe have not yet received payment for your booking. Please complete the payment so we can proceed. If you have already paid, please ignore this message.\n\nKind regards,\nApply ECS'],
  done: ['Your booking is complete - Apply ECS', 'Dear {n},\n\nYour booking has been completed. If you need any further help, just reply to this email.\n\nKind regards,\nApply ECS'],
};
async function viewBooking(id) {
  const b = await api('/bookings/' + id);
  const extra = Object.entries(b.extra || {}).map(([k, v]) => `<tr><th class="k">${esc(k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))}</th><td>${esc(v)}</td></tr>`).join('');
  const docs = [['id_file', 'ID document'], ['photo_file', 'Applicant photo'], ['file3', 'H&S test proof']].filter(([k]) => b[k]).map(([k, l]) => `<a class="btn" target="_blank" rel="noopener" href="/admin-api/file/${id}/${k}">${l}</a> `).join('');
  $app.innerHTML = `<p><a href="#/bookings">&larr; Back</a></p><div id="msg"></div>
  <div class="card wrap"><h3>Booking #${id}</h3><table>${Object.entries(LABELS).map(([k, l]) => `<tr><th class="k">${l}</th><td>${esc(k === 'created' ? fmt(b[k]) : b[k])}</td></tr>`).join('')}${extra}<tr><th class="k">Documents</th><td>${docs || '–'}</td></tr></table></div>
  <div class="card"><h3>Contact customer</h3><p>${quick(b.mobile, b.email)} <a class="btn" style="background:#6c3fc5" href="#/customer/${encodeURIComponent(custKey(b.email, b.mobile))}">All tests / activity of this customer</a></p></div>
  <div class="card"><form id="sf"><p>Status: <select name="status">${STATUSES.map((x) => `<option${x === b.status ? ' selected' : ''}>${x}</option>`).join('')}</select></p>
  <p><textarea class="full" name="notes" rows="4" placeholder="Internal notes">${esc(b.notes)}</textarea></p><button>Save</button> <button type="button" class="red" id="del">Delete</button></form></div>
  <div class="card"><h3>Email this customer (${esc(b.email)})</h3><form id="mf"><p><select id="tpl"><option value="">Choose template...</option><option value="received">Booking received</option><option value="docs">Documents needed</option><option value="pay">Payment reminder</option><option value="done">Booking completed</option></select></p>
  <p><input class="full" name="subject" placeholder="Subject"></p><p><textarea class="full" name="body" rows="6" placeholder="Message"></textarea></p><button>Send email</button></form></div>`;
  const say = (m, bad) => (document.getElementById('msg').innerHTML = msgBox(m, bad));
  document.getElementById('sf').onsubmit = async (e) => { e.preventDefault(); try { await api('/bookings/' + id, { method: 'PATCH', body: form(e.target) }); say('Saved.'); nav(); } catch (x) { say(x.message, 1); } };
  document.getElementById('del').onclick = async () => { if (!confirm('Delete this booking and its documents permanently?')) return; try { await api('/bookings/' + id, { method: 'DELETE' }); location.hash = '#/bookings'; } catch (x) { say(x.message, 1); } };
  document.getElementById('tpl').onchange = (e) => { const t = TPL[e.target.value], f = document.getElementById('mf'); if (t) { f.subject.value = t[0]; f.body.value = t[1].replace('{n}', b.full_name); } };
  document.getElementById('mf').onsubmit = async (e) => { e.preventDefault(); try { await api(`/bookings/${id}/email`, { method: 'POST', body: form(e.target) }); say('Email sent to customer.'); viewBooking(id); } catch (x) { say(x.message, 1); } };
}

// ---------- enquiries ----------
async function viewEnquiries() {
  const rows = await api('/enquiries');
  let people = {}; try { for (const c of (await api('/customers')).rows) people[c.key] = c; } catch (_) {}
  const booked = (r) => { const c = people[custKey(r.email, r.phone)]; return c && c.bookings.length ? `<div class="card" style="background:#eef7ee;margin:8px 0"><b>This customer has made a booking:</b><br>${c.bookings.map((b) => `<a href="#/booking/${b.id}">#${b.id}</a> ${esc(b.test)} &middot; ${esc(b.centre)} &middot; ${esc(b.test_date)} <span class="tag">${esc(b.status)}</span>`).join('<br>')} <br><a href="#/customer/${encodeURIComponent(c.key)}">Customer profile</a></div>` : '<p><small>No bookings yet from this email address.</small></p>'; };
  $app.innerHTML = `<div class="card"><h3>Contact enquiries (${rows.length}) <a class="btn" style="float:right" href="/admin-api/export/enquiries.csv">Export CSV</a></h3>${rows.map((r) => `<details style="border-bottom:1px solid #eee;padding:8px 0"><summary><b>${esc(r.name)}</b> &middot; ${esc(r.subject)} &middot; <small>${esc(fmt(r.created))}</small> <span class="tag">${esc(r.status)}</span>${(r.cart || []).length ? ' <span class="tag" style="background:#ffe9b3">cart</span>' : ''}${people[custKey(r.email, r.phone)]?.bookings.length ? ' <span class="tag" style="background:#d4f3d4">booked</span>' : ''}</summary>
  <p>${esc(r.email)}${r.phone ? ' &middot; ' + esc(r.phone) : ''}</p><p style="background:#f7f7f7;padding:10px;border-radius:6px">${nl2br(r.message)}</p>${(r.cart || []).length ? `<div class="card" style="background:#fff8e6;margin:8px 0"><b>Items in the cart:</b><br>${r.cart.map((i) => esc(i.name || i.id) + (i.qty > 1 ? ' x' + i.qty : '') + ' (£' + esc(i.price) + ')').join('<br>')}<br><b>Total: £${r.cart.reduce((n, i) => n + i.price * (i.qty || 1), 0)}</b></div>` : ''}${booked(r)}
  ${quick(r.phone, '')} <a class="btn" href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Re: ' + r.subject)}">Reply by email</a>
  <button data-a="Replied" data-id="${r.id}">Mark replied</button> <button data-a="Closed" data-id="${r.id}">Close</button> <button class="red" data-a="delete" data-id="${r.id}">Delete</button></details>`).join('') || '<p>No enquiries yet.</p>'}</div>`;
  $app.querySelectorAll('button[data-a]').forEach((b) => (b.onclick = async () => {
    if (b.dataset.a === 'delete' && !confirm('Delete this enquiry?')) return;
    try { await api('/enquiries/' + b.dataset.id, { method: 'POST', body: { action: b.dataset.a } }); route(); } catch (e) { fail(e); }
  }));
}


// ---------- cart activity ----------
async function viewCart() {
  const all = await api('/cart'), kf = (location.hash.split('?')[1] || '').replace('k=', '');
  const rows = kf ? all.filter((r) => r.kind === kf) : all;
  const items = (r) => (r.items || []).map((i) => esc(i.name || i.id) + (i.qty > 1 ? ' x' + i.qty : '') + ' (£' + i.price + ')').join('<br>');
  const who = (r) => [r.name, r.email, r.phone].filter(Boolean).map(esc).join('<br>') || '<small>no details yet</small>';
  $app.innerHTML = `<div class="card wrap"><h3>Cart activity (${rows.length}) <a class="btn" style="float:right" href="/admin-api/export/cart.csv">Export CSV</a></h3><p><select id="kf"><option value="">All</option><option value="checkout"${kf === 'checkout' ? ' selected' : ''}>Checkout started (name + email + phone)</option><option value="add_to_cart"${kf === 'add_to_cart' ? ' selected' : ''}>Added to cart</option></select></p><p><small>"Added to cart" = visitor clicked Add to cart. "Checkout started" = visitor entered name / email / phone and clicked Pay.</small></p>
  <table><tr><th>Time</th><th>Event</th><th>Items</th><th>Total</th><th>Customer</th><th>Page</th><th></th></tr>
  ${rows.map((r) => `<tr><td>${esc(fmt(r.created))}</td><td><span class="tag">${r.kind === 'checkout' ? 'Checkout started' : 'Added to cart'}</span></td><td>${items(r)}</td><td>£${esc(r.total)}</td><td>${who(r)}</td><td><small>${esc(r.page)}</small></td><td><button class="red" data-id="${r.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="7">No cart activity yet.</td></tr>'}</table></div>`;
  document.getElementById('kf').onchange = (e) => { location.hash = '#/cart' + (e.target.value ? '?k=' + e.target.value : ''); };
  $app.querySelectorAll('button[data-id]').forEach((b) => (b.onclick = async () => { try { await api('/cart/' + b.dataset.id, { method: 'DELETE' }); route(); } catch (e) { fail(e); } }));
}


// ---------- home dashboard ----------
async function viewHome() {
  const d = await api('/dashboard'), box = (t, o) => `<div class="stat"><b>${o}</b>${t}</div>`;
  const row = (title, o) => `<div class="card"><h3>${title}</h3><div class="stats">${box('Bookings', o.bookings)}${box('Enquiries', o.enquiries)}${box('Added to cart', o.adds)}${box('Checkout started', o.checkouts)}</div></div>`;
  const li = (a) => a.map((x) => `<li>${x}</li>`).join('') || '<li>-</li>';
  $app.innerHTML = `<div class="card"><h3>On the site now: <a href="#/live" style="color:#2ecc71">${d.online || 0} visitor online</a></h3></div>` + row('Last 24 hours', d.today) + row('Last 7 days', d.week) + `<div class="stats" style="align-items:stretch">
  <div class="card" style="flex:1;min-width:260px"><h3>Latest bookings</h3><ul>${li(d.latest.bookings.map((r) => `<a href="#/booking/${r.id}">#${r.id} ${esc(r.full_name)}</a> <small>${esc(r.type)} &middot; ${esc(fmt(r.created))}</small>`))}</ul></div>
  <div class="card" style="flex:1;min-width:260px"><h3>Latest enquiries</h3><ul>${li(d.latest.enquiries.map((r) => `<a href="#/enquiries">${esc(r.name)}</a> <small>${esc(r.subject)} &middot; ${esc(fmt(r.created))}</small>`))}</ul></div>
  <div class="card" style="flex:1;min-width:260px"><h3>Latest cart activity</h3><ul>${li(d.latest.cart.map((r) => `<a href="#/cart">${r.kind === 'checkout' ? 'Checkout: ' + esc(r.name || r.email) : 'Added: ' + esc((r.items[0] || {}).name || '')}</a> <small>${esc(fmt(r.created))}</small>`))}</ul></div></div>`;
}

// ---------- upcoming tests calendar ----------
const toDate = (s) => { const t = String(s || '').trim(); let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]); m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); if (m) return new Date(+m[3], +m[2] - 1, +m[1]); const d = new Date(t); return isNaN(d) ? null : d; };
async function viewUpcoming() {
  const rows = await api('/upcoming'), today = new Date(); today.setHours(0, 0, 0, 0);
  const days = {};
  rows.forEach((r) => { const d = toDate(r.test_date); if (d && d >= today) (days[d.getTime()] ||= []).push(r); });
  const keys = Object.keys(days).map(Number).sort((a, b) => a - b), diff = (t) => Math.round((t - today.getTime()) / 864e5);
  $app.innerHTML = `<div class="card"><h3>Upcoming tests (${keys.reduce((n, k) => n + days[k].length, 0)})</h3><p><small>Bookings with a test date of today or later (excluding Cancelled).</small></p></div>` + (keys.map((k) => {
    const dd = diff(k), tag = dd === 0 ? 'TODAY' : dd === 1 ? 'TOMORROW' : '';
    return `<div class="card wrap"><h3>${new Date(k).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} ${tag ? `<span class="badge">${tag}</span>` : ''}</h3><table><tr><th>Time</th><th>Name</th><th>Test</th><th>Centre</th><th>Mobile</th><th>Status</th><th></th></tr>
    ${days[k].map((r) => `<tr><td>${esc(r.test_time)}</td><td><a href="#/booking/${r.id}">${esc(r.full_name)}</a></td><td>${esc(r.test_type)}</td><td>${esc(r.centre)}</td><td>${esc(r.mobile)}</td><td><span class="tag">${esc(r.status)}</span></td><td>${quick(r.mobile, '')}</td></tr>`).join('')}</table></div>`;
  }).join('') || '<div class="card">No upcoming test bookings found.</div>');
}

// ---------- header / footer: hide menu items + words (switch OFF = hidden, ON = shown) ----------
const normT = (t) => String(t || '').replace(/[\u25BE\u25BC\u2193]/g, '').replace(/\s+/g, ' ').trim();
async function viewHeader() {
  const cur = await api('/menu'), hrefs = new Set(cur.href || []), texts = new Set((cur.text || []).map((x) => x.toLowerCase()));
  const items = [], seen = new Set();
  for (const [file, sec] of [['/header.html', 'Header'], ['/footer.html', 'Footer']]) {
    let doc; try { doc = new DOMParser().parseFromString(await (await fetch(file + '?_=' + Date.now())).text(), 'text/html'); } catch (_) { continue; }
    doc.body.querySelectorAll('a[href], button.accordion-header').forEach((e) => {
      const label = normT(e.textContent), h = e.getAttribute('href'), link = e.tagName === 'A' && h && h !== '#' && !h.startsWith('javascript');
      const key = link ? 'h:' + h : 't:' + label.toLowerCase();
      if (!label || seen.has(sec + key)) return; seen.add(sec + key);
      const hidden = link ? hrefs.has(h) : texts.has(label.toLowerCase());
      items.push({ sec, label, kind: link ? 'href' : 'text', v: link ? h : label.toLowerCase(), depth: e.closest('.accordion-content') ? 1 : 0, group: e.tagName === 'BUTTON', visible: !hidden });
    });
  }
  const known = new Set(items.filter((x) => x.kind === 'text').map((x) => x.v));
  const extraTexts = (cur.text || []).filter((x) => !known.has(x));
  let words = [...(cur.words || [])];
  const rows = (name) => items.map((it, i) => it.sec !== name ? '' : `<div class="mi" data-s="${esc((it.label + ' ' + it.v).toLowerCase())}" style="margin-left:${it.depth * 26}px">
    <label class="sw"><input type="checkbox" data-i="${i}"${it.visible ? ' checked' : ''}><span></span></label>
    <span class="st ${it.visible ? 'vis' : 'hid'}">${it.visible ? 'Visible' : 'Hidden'}</span>
    <span class="lb${it.group ? ' grp' : ''}">${esc(it.label)}</span> <small style="color:#888">${it.kind === 'href' ? esc(it.v) : '(group / text)'}</small></div>`).join('');
  $app.innerHTML = `<div id="msg"></div><div class="card"><h3>Header &amp; footer menu</h3>
  <p><small>Switch <b>OFF</b> = the menu item is <b>hidden from the site immediately</b> (10-20 seconds). Switch <b>ON</b> = shown again. Every click saves automatically. Switching off a whole group (dropdown) also hides all the links inside it.</small></p>
  <p><input id="mq" class="full" placeholder="Search menu items..."> <button type="button" id="allon">Show all</button> <a class="btn" href="/" target="_blank" rel="noopener">Open site</a></p>
  <h4>Header</h4>${rows('Header')}<h4>Footer</h4>${rows('Footer')}</div>
  <div class="card"><h3>Hide any word</h3><p><small>Wherever this word appears in the header / footer it will be removed (e.g. <b>SAVE</b>, <b>NEW</b>, <b>Gold</b>). Click &times; on a chip to show the word again.</small></p>
  <p><input id="wi" placeholder="Word likho..." style="width:240px"> <button type="button" id="wa">Hide word</button></p><div id="chips"></div>
  <p style="margin-top:14px">Extra texts (hides the whole item, one per line)<br><textarea id="tt" class="full" rows="3">${esc(extraTexts.join('\n'))}</textarea></p><button type="button" id="sv">Save</button></div>`;
  const chips = () => (document.getElementById('chips').innerHTML = words.map((w, i) => `<span class="chip">${esc(w)} <b data-w="${i}">&times;</b></span>`).join('') || '<small>No words hidden.</small>');
  let timer;
  const save = () => { clearTimeout(timer); timer = setTimeout(async () => {
    const off = items.filter((x) => !x.visible), lines = document.getElementById('tt').value.split('\n').map((x) => x.trim()).filter(Boolean);
    try { const r = await api('/menu', { method: 'POST', body: { href: off.filter((x) => x.kind === 'href').map((x) => x.v), text: [...off.filter((x) => x.kind === 'text').map((x) => x.v), ...lines], words } }); document.getElementById('msg').innerHTML = msgBox('Saved ✔ ' + r.message); } catch (x) { fail(x); }
  }, 350); };
  const paint = (cb) => { const it = items[+cb.dataset.i], st = cb.closest('.mi').querySelector('.st'); it.visible = cb.checked; st.textContent = it.visible ? 'Visible' : 'Hidden'; st.className = 'st ' + (it.visible ? 'vis' : 'hid'); };
  $app.querySelectorAll('input[data-i]').forEach((cb) => (cb.onchange = () => { paint(cb); save(); }));
  document.getElementById('allon').onclick = () => { $app.querySelectorAll('input[data-i]').forEach((cb) => { cb.checked = true; paint(cb); }); words = []; chips(); document.getElementById('tt').value = ''; save(); };
  document.getElementById('mq').oninput = (e) => $app.querySelectorAll('.mi').forEach((l) => (l.style.display = l.dataset.s.includes(e.target.value.toLowerCase()) ? '' : 'none'));
  const addWord = () => { const i = document.getElementById('wi'), w = i.value.trim(); if (w && !words.some((x) => x.toLowerCase() === w.toLowerCase())) { words.push(w); chips(); save(); } i.value = ''; };
  document.getElementById('wa').onclick = addWord; document.getElementById('wi').onkeydown = (e) => { if (e.key === 'Enter') addWord(); };
  document.getElementById('chips').onclick = (e) => { const i = e.target.dataset.w; if (i !== undefined) { words.splice(+i, 1); chips(); save(); } };
  document.getElementById('sv').onclick = save; chips();
}


// ---------- live visitors ----------
let liveOnly = false;
async function viewLive() {
  const draw = async () => {
    let d; try { d = await api('/live'); } catch (e) { fail(e); return; }
    const now = new Date(d.now).getTime(), age = (r) => (now - new Date(r.last_seen).getTime()) / 1000;
    const online = d.rows.filter((r) => age(r) < 75), dur = (r) => { const s = Math.max(0, Math.round((new Date(r.last_seen) - new Date(r.first_seen)) / 1000)); return s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's'; };
    const cart = (r) => (r.cart || []).length ? (r.cart.map((i) => esc(i.name || i.id) + ' (£' + i.price + ')').join('<br>') + '<br><b>£' + r.cart.reduce((n, i) => n + i.price * (i.qty || 1), 0) + '</b>') : '-';
    const who = (r) => (r.name || r.email || r.phone) ? `<b>${esc(r.name)}</b><br><small>${esc(r.email)}<br>${esc(r.phone)}</small>${r.bookings.length ? `<br><span class="tag" style="background:#d4f3d4">Customer: ${r.bookings.map((b) => esc(b.test)).join(', ')}</span>` : ''}` : `<small>Anonymous #${esc(r.vid.slice(0, 5))}</small>`;
    const doing = (r) => { const f = r.form || {}, bits = [f.card, f.test, f.centre, f.date].filter(Boolean).map(esc); return `<b>${esc(r.activity || 'Browsing')}</b>${bits.length ? '<br><small>' + bits.join(' &middot; ') + '</small>' : ''}`; };
    const list = liveOnly ? online : d.rows;
    $app.innerHTML = `<div class="stats"><div class="stat"><b style="color:#2ecc71">${online.length}</b>Online now</div><div class="stat"><b>${d.rows.length}</b>Last 10 min</div><div class="stat"><b>${d.rows.filter((r) => /form|checkout/i.test(r.activity || '')).length}</b>In form / checkout</div><div class="stat"><b>${d.rows.filter((r) => (r.cart || []).length).length}</b>Items in cart</div><div class="stat"><b>${d.rows.filter((r) => r.email).length}</b>Left details</div></div><br>
    <div class="card wrap"><h3>Live visitors <small style="font-weight:normal">(updates every 5 seconds)</small> <label style="float:right;font-weight:normal;font-size:14px"><input type="checkbox" id="lo2"${liveOnly ? ' checked' : ''}> Show online only</label></h3><table><tr><th></th><th>Visitor</th><th>Current activity</th><th>Page</th><th>Time</th><th>Pages</th><th>Cart</th><th>Device / place / IP</th><th>From</th></tr>
    ${list.map((r) => { const on = age(r) < 75; return `<tr style="${on ? '' : 'opacity:.55'}"><td><span style="color:${on ? '#2ecc71' : '#bbb'}">&#9679;</span></td><td>${who(r)}${r.phone || r.email ? '<br>' + quick(r.phone, r.email) : ''}</td><td>${doing(r)}</td><td>${esc(r.title || r.page)}<br><small>${esc(r.page)}</small></td><td>${dur(r)}<br><small>${on ? 'active' : Math.round(age(r) / 60) + ' min ago'}</small></td>
    <td><details><summary>${r.views}</summary><small>${(r.pages || []).slice().reverse().map((x) => esc(x.p)).join('<br>')}</small></details></td><td>${cart(r)}</td><td>${esc(r.device)}<br><small>${esc([r.city, r.country].filter(Boolean).join(', '))}<br>${esc(r.ip)}</small>${r.ip ? (r.blocked ? '<br><span class="tag">blocked</span>' : `<br><button class="red" data-block="${esc(r.ip)}" style="padding:2px 8px;font-size:12px">Block IP</button>`) : ''}</td><td><small>${esc(r.ref) || 'direct'}</small></td></tr>`; }).join('') || '<tr><td colspan="9">No visitors right now.</td></tr>'}</table></div>`;
    document.getElementById('lo2').onchange = (e) => { liveOnly = e.target.checked; draw(); };
    $app.querySelectorAll('[data-block]').forEach((b) => (b.onclick = async () => { if (!confirm('IP ' + b.dataset.block + ' - block this IP? It will no longer be able to submit forms or be tracked.')) return; try { await api('/blocked', { method: 'POST', body: { action: 'add', ip: b.dataset.block, note: 'from Live' } }); draw(); } catch (x) { fail(x); } }));
  };
  await draw();
  window.__live = setInterval(draw, 5000);
}

// ---------- customers: which user booked which test ----------
const testsHtml = (bs) => bs.length ? bs.map((b) => `<a href="#/booking/${b.id}"><b>${esc(b.test)}</b></a> <small>${esc(b.centre)} ${esc(b.test_date)} ${esc(b.test_time || '')}</small> <span class="tag">${esc(b.status)}</span>`).join('<br>') : '<small>no bookings</small>';
async function viewCustomers() {
  const d = await api('/customers');
  const draw = () => {
    const q = document.getElementById('cq').value.toLowerCase(), f = document.getElementById('cf').value;
    const rows = d.rows.filter((c) => (!q || [c.name, c.email, c.mobile, ...c.bookings.map((b) => b.test + ' ' + b.centre)].join(' ').toLowerCase().includes(q)) && (f === '' || (f === 'booked' ? c.bookings.length : !c.bookings.length))).slice(0, 300);
    document.getElementById('ct').innerHTML = `<tr><th>Customer</th><th>Test / card booked</th><th>Enquiries</th><th>Checkouts</th><th>Last activity</th><th></th></tr>` + (rows.map((c) => `<tr><td><b>${esc(c.name)}</b><br><small>${esc(c.email)}<br>${esc(c.mobile)}</small></td><td>${testsHtml(c.bookings)}</td><td>${c.enquiries.length}</td><td>${c.carts.length}</td><td><small>${esc(fmt(c.last))}</small></td><td><a class="btn" href="#/customer/${encodeURIComponent(c.key)}">Open</a><br>${quick(c.mobile, c.email)}</td></tr>`).join('') || '<tr><td colspan="6">No customers found.</td></tr>');
  };
  $app.innerHTML = `<div class="card wrap"><h3>Customers (${d.total}) <a class="btn" style="float:right" href="/admin-api/customers.csv">Export CSV (customer + test)</a></h3><p><small>Shows which test / card each customer booked, at which centre and for which date. Bookings, enquiries and checkouts are linked by the same email / mobile number.</small></p>
  <p><input id="cq" placeholder="Search name / email / mobile / test / centre" style="width:320px"> <select id="cf"><option value="">All</option><option value="booked">Has booked</option><option value="no">Has not booked</option></select></p><table id="ct"></table></div>`;
  document.getElementById('cq').oninput = draw; document.getElementById('cf').onchange = draw; draw();
}
async function viewCustomer(arg) {
  const c = await api('/customer?k=' + encodeURIComponent(decodeURIComponent(arg || '')));
  $app.innerHTML = `<p><a href="#/customers">&larr; Customers</a></p><div class="card"><h3>${esc(c.name || 'Customer')}</h3><p>${esc(c.email)} &middot; ${esc(c.mobile)}</p><p>${quick(c.mobile, c.email)}</p></div>
  <div class="card wrap"><h3>Tests / cards booked (${c.bookings.length})</h3><table><tr><th>#</th><th>Booked on</th><th>Form</th><th>Test / card</th><th>Centre</th><th>Test date</th><th>Status</th></tr>${c.bookings.map((b) => `<tr><td><a href="#/booking/${b.id}">${b.id}</a></td><td>${esc(fmt(b.created))}</td><td>${esc(b.type)}</td><td><b>${esc(b.test)}</b></td><td>${esc(b.centre)}</td><td>${esc((b.test_date || '') + ' ' + (b.test_time || ''))}</td><td><span class="tag">${esc(b.status)}</span></td></tr>`).join('') || '<tr><td colspan="7">No bookings.</td></tr>'}</table></div>
  <div class="card wrap"><h3>Enquiries (${c.enquiries.length})</h3><table>${c.enquiries.map((e) => `<tr><td>${esc(fmt(e.created))}</td><td>${esc(e.subject)}</td><td><span class="tag">${esc(e.status)}</span></td></tr>`).join('') || '<tr><td>No enquiries.</td></tr>'}</table></div>
  <div class="card wrap"><h3>Checkout (cart) activity (${c.carts.length})</h3><table>${c.carts.map((e) => `<tr><td>${esc(fmt(e.created))}</td><td>${(e.items || []).map((i) => esc(i.name || i.id)).join(', ')}</td><td>£${esc(e.total)}</td></tr>`).join('') || '<tr><td>No checkouts.</td></tr>'}</table></div>
  <div class="card wrap"><h3>Site visits (${c.sessions.length})</h3><table>${c.sessions.map((v) => `<tr><td>${esc(fmt(v.last_seen))}</td><td>${v.views} pages</td><td>${esc(v.device)} ${esc([v.city, v.country].filter(Boolean).join(', '))}</td></tr>`).join('') || '<tr><td>No live visit records.</td></tr>'}</table></div>`;
}

// ---------- leads: showed interest but did not book ----------
async function viewLeads() {
  const d = await api('/leads'); let hideDone = true;
  const draw = () => {
    const rows = d.rows.filter((l) => !(hideDone && l.done));
    document.getElementById('lt').innerHTML = `<tr><th>Last seen</th><th>Person</th><th>Source</th><th>Interested in</th><th>Value</th><th>Follow-up</th><th></th></tr>` + (rows.map((l) => `<tr style="${l.done ? 'opacity:.5' : ''}"><td><small>${esc(fmt(l.last))}</small></td><td><b>${esc(l.name)}</b><br><small>${esc(l.email)}<br>${esc(l.phone)}</small></td><td>${l.sources.map((x) => `<span class="tag">${esc(x)}</span>`).join(' ')}</td><td><small>${esc(l.info)}</small></td><td>${l.total ? '£' + esc(l.total) : ''}</td><td>${quick(l.phone, l.email)}</td><td><button data-k="${esc(l.key)}" data-d="${l.done ? 0 : 1}">${l.done ? 'Reopen' : 'Done'}</button></td></tr>`).join('') || '<tr><td colspan="7">No pending leads. 🎉</td></tr>');
    document.querySelectorAll('#lt button[data-k]').forEach((b) => (b.onclick = async () => { try { await api('/leads', { method: 'POST', body: { key: b.dataset.k, done: b.dataset.d === '1' } }); const l = d.rows.find((x) => x.key === b.dataset.k); l.done = b.dataset.d === '1'; draw(); } catch (e) { fail(e); } }));
  };
  $app.innerHTML = `<div class="card wrap"><h3>Leads to follow up (${d.rows.filter((l) => !l.done).length})</h3><p><small>These are people who entered their name / email / phone at checkout, sent an enquiry or left details on the live site, but have <b>not booked yet</b>. Follow up by WhatsApp / phone, then click <b>Done</b>.</small></p><p><label><input type="checkbox" id="hd" checked> Hide completed</label></p><table id="lt"></table></div>`;
  document.getElementById('hd').onchange = (e) => { hideDone = e.target.checked; draw(); }; draw();
}

// ---------- reports: test-wise / centre-wise ----------
async function viewReports() {
  const hq = new URLSearchParams(location.hash.split('?')[1] || ''), qs = new URLSearchParams({ from: hq.get('from') || '', to: hq.get('to') || '' });
  const d = await api('/reports?' + qs), days = Object.entries(d.days).sort(), max = Math.max(1, ...days.map((x) => x[1]));
  const block = (title, arr) => `<div class="card wrap"><h3>${title}</h3>${arr.map((g) => `<details style="border-bottom:1px solid #eee;padding:6px 0"><summary><b>${esc(g.k)}</b> &mdash; ${g.n} booking${g.n > 1 ? 's' : ''}</summary><table>${g.list.map((b) => `<tr><td><a href="#/booking/${b.id}">#${b.id}</a></td><td>${esc(b.name)}<br><small>${esc(b.email)}</small></td><td>${esc(b.centre)}</td><td>${esc(b.test_date)}</td><td><span class="tag">${esc(b.status)}</span></td></tr>`).join('')}</table></details>`).join('') || '<p>No bookings in this date range.</p>'}</div>`;
  $app.innerHTML = `<div class="card"><h3>Reports</h3><form id="rf">From <input type="date" name="from" value="${esc(d.from)}"> To <input type="date" name="to" value="${esc(d.to)}"> <button>Show</button> <a class="btn" href="/admin-api/reports.csv?${new URLSearchParams({ from: d.from, to: d.to })}">Export CSV</a></form></div>
  <div class="stats"><div class="stat"><b>${d.total}</b>Bookings</div><div class="stat"><b>${d.paid}</b>Paid / booked / done</div><div class="stat"><b>${d.byTest.length}</b>Different tests</div><div class="stat"><b>${d.byCentre.length}</b>Centres</div></div><br>
  <div class="card"><h3>Bookings per day</h3><div style="display:flex;align-items:flex-end;gap:3px;height:110px">${days.map(([k, c]) => `<div title="${esc(k)}: ${c}" style="flex:1;background:#005a9c;border-radius:3px 3px 0 0;height:${Math.max(4, Math.round((c / max) * 100))}%"></div>`).join('') || '<small>No data</small>'}</div></div>
  ${block('By test: who booked which test (click to open)', d.byTest)}${block('Centre-wise', d.byCentre)}${block('Status-wise', d.byStatus)}`;
  document.getElementById('rf').onsubmit = (e) => { e.preventDefault(); location.hash = '#/reports?' + new URLSearchParams(form(e.target)); };
}

// ---------- global search ----------
async function viewSearch() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '', d = await api('/search?' + new URLSearchParams({ q }));
  $app.innerHTML = `<div class="card"><h3>Search: "${esc(q)}"</h3></div>
  <div class="card wrap"><h3>Bookings (${d.bookings.length})</h3><table>${d.bookings.map((b) => `<tr><td><a href="#/booking/${b.id}">#${b.id}</a></td><td>${esc(b.full_name)}<br><small>${esc(b.email)} ${esc(b.mobile)}</small></td><td>${esc(b.test_type || b.card_type || b.type)}</td><td>${esc(b.centre)} ${esc(b.test_date)}</td><td><span class="tag">${esc(b.status)}</span></td><td><a href="#/customer/${encodeURIComponent(custKey(b.email, b.mobile))}">Customer</a></td></tr>`).join('') || '<tr><td>Nothing found.</td></tr>'}</table></div>
  <div class="card wrap"><h3>Enquiries (${d.enquiries.length})</h3><table>${d.enquiries.map((e) => `<tr><td>${esc(fmt(e.created))}</td><td>${esc(e.name)}<br><small>${esc(e.email)} ${esc(e.phone)}</small></td><td>${esc(e.subject)}</td><td><a href="#/enquiries">Open</a></td></tr>`).join('') || '<tr><td>Nothing found.</td></tr>'}</table></div>
  <div class="card wrap"><h3>Cart / checkout (${d.cart.length})</h3><table>${d.cart.map((c) => `<tr><td>${esc(fmt(c.created))}</td><td>${esc(c.name)}<br><small>${esc(c.email)} ${esc(c.phone)}</small></td><td>${(c.items || []).map((i) => esc(i.name || i.id)).join(', ')}</td><td>${c.kind === 'checkout' ? 'Checkout' : 'Added'}</td></tr>`).join('') || '<tr><td>Nothing found.</td></tr>'}</table></div>`;
}

// ---------- stats ----------
async function viewStats() {
  const s = await api('/stats'), days = Object.entries(s.days), max = Math.max(1, ...days.map((d) => d[1]));
  $app.innerHTML = `<div class="stats"><div class="stat"><b>${s.total}</b>Total bookings</div><div class="stat"><b>${s.week}</b>Last 7 days</div><div class="stat"><b>${s.month}</b>Last 30 days</div><div class="stat"><b>${s.paidPct}%</b>Paid / booked</div><div class="stat"><b>${s.enquiries}</b>Enquiries</div></div><br>
  <div class="card"><h3>Bookings per day (last 30 days)</h3><div style="display:flex;align-items:flex-end;gap:3px;height:140px">${days.map(([d, c]) => `<div title="${esc(d)}: ${c}" style="flex:1;background:#005a9c;border-radius:3px 3px 0 0;height:${c ? Math.max(4, Math.round((c / max) * 100)) : 1}%;opacity:${c ? 1 : 0.25}"></div>`).join('')}</div><small>Oldest &larr; &rarr; Today. Hover a bar for the date.</small></div>
  <div class="card wrap"><h3>Upcoming tests</h3><table><tr><th>Date</th><th>Name</th><th>Test</th><th>Centre</th><th>Status</th><th></th></tr>${s.upcoming.map((r) => `<tr><td>${esc((r.test_date + ' ' + (r.test_time || '')).trim())}</td><td>${esc(r.full_name)}</td><td>${esc(r.test_type)}</td><td>${esc(r.centre)}</td><td><span class="tag">${esc(r.status)}</span></td><td><a class="btn" href="#/booking/${r.id}">Open</a></td></tr>`).join('') || '<tr><td colspan="6">No upcoming tests (needs dates in YYYY-MM-DD format).</td></tr>'}</table></div>
  ${Object.entries(s.lists).map(([t, rows]) => { const m = Math.max(1, rows[0]?.n || 1); return `<div class="card"><h3>${esc(t)}</h3><table>${rows.map((r) => `<tr><td style="width:45%">${esc(r.k)}</td><td><div style="background:#005a9c;height:14px;border-radius:4px;width:${Math.round((r.n / m) * 100)}%"></div></td><td style="width:40px">${r.n}</td></tr>`).join('') || '<tr><td>No data yet</td></tr>'}</table></div>`; }).join('')}`;
}

// ---------- pages ----------
async function viewPages() {
  const pages = await api('/pages'), live = pages.filter((p) => p.state !== 'deleted'), trash = pages.filter((p) => p.state === 'deleted');
  const btn = (a, slug, label, red) => `<button class="${red ? 'red' : ''}" data-a="${a}" data-s="${esc(slug)}">${label}</button> `;
  $app.innerHTML = `<div id="msg">${msgBox(flash)}</div><div class="card"><h3>Pages (${live.length})</h3>
  <p><small>Hide = visitors see 404 and menu links disappear. Delete = same as hide, listed in Trash and can be restored (the file itself stays in your code). Home page is protected. Changes go live within ~1 minute.</small></p>
  <input id="f" class="full" placeholder="Search pages...">
  <div class="wrap"><table id="t"><tr><th>Page</th><th>Status</th><th>Actions</th></tr>${live.map((p) => `<tr data-s="${esc((p.slug + ' ' + p.title).toLowerCase())}"><td><a href="/${esc(p.slug)}.html" target="_blank" rel="noopener">${esc(p.slug)}.html</a><br><small>${esc(p.title)}</small></td><td><span class="tag">${p.state === 'hidden' ? 'Hidden' : 'Visible'}</span></td><td>${p.locked ? '<small>protected</small>' : btn(p.state === 'hidden' ? 'show' : 'hide', p.slug, p.state === 'hidden' ? 'Show' : 'Hide') + btn('delete', p.slug, 'Delete', 1)}</td></tr>`).join('')}</table></div></div>
  ${trash.length ? `<div class="card"><h3>Trash</h3><table>${trash.map((p) => `<tr><td>${esc(p.slug)}.html</td><td>${btn('restore', p.slug, 'Restore')}</td></tr>`).join('')}</table></div>` : ''}`;
  flash = '';
  document.getElementById('f').onkeyup = (e) => { const q = e.target.value.toLowerCase(); document.querySelectorAll('#t tr[data-s]').forEach((r) => (r.style.display = r.dataset.s.includes(q) ? '' : 'none')); };
  $app.querySelectorAll('button[data-a]').forEach((b) => (b.onclick = async () => {
    if (b.dataset.a === 'delete' && !confirm('Delete ' + b.dataset.s + '.html? (goes to Trash)')) return;
    try { await api('/pages', { method: 'POST', body: { action: b.dataset.a, slug: b.dataset.s } }); flash = 'Updated.'; route(); } catch (e) { fail(e); }
  }));
}

// ---------- design ----------
async function viewDesign() {
  const { fields, fonts, values: s } = await api('/design');
  let g = '', html = '';
  for (const f of fields) {
    if (f.group !== g) { if (g) html += '</div>'; html += `<div class="card"><h3>${esc(f.group)}</h3>`; g = f.group; }
    const used = s[f.key] !== undefined && s[f.key] !== '', val = s[f.key] ?? f.def, n = `name="${f.key}"`;
    const use = (k) => `<label><input type="checkbox" data-use="${k}" ${used ? 'checked' : ''}> use</label>`;
    html += `<p><label style="display:inline-block;min-width:260px">${esc(f.label)}</label>` + ({
      color: `<input type="color" ${n} value="${esc(val)}"> ${use(f.key)}`,
      num: `<input type="number" ${n} value="${esc(val)}" min="${f.min}" max="${f.max}" style="width:90px"> ${use(f.key)}`,
      bool: `<select ${n}><option value="1">On</option><option value="0" ${s[f.key] === '0' ? 'selected' : ''}>Off</option></select>`,
      font: `<select ${n}>${Object.entries(fonts).map(([k, l]) => `<option value="${esc(k)}"${k === (s[f.key] || '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`,
      text: `<input ${n} value="${esc(s[f.key] || '')}" maxlength="200" style="width:60%" placeholder="Leave empty = no banner">`,
      area: `<br><textarea ${n} rows="5" class="full">${esc(s[f.key] || '')}</textarea>`,
    })[f.type] + '</p>';
  }
  $app.innerHTML = `<div id="msg">${msgBox(flash)}</div><form id="df"><p><small>Tick "use" to override a value; unticked = original site design stays. After saving, wait ~1 minute and hard-refresh the site (Ctrl+F5).</small></p>${html}</div>
  <button>Save design</button> <button type="button" class="red" id="rs">Reset to original</button></form>`;
  flash = '';
  const send = async (payload) => { try { await api('/design', { method: 'POST', body: payload }); flash = payload.reset ? 'Reset to original design.' : 'Saved. Live within about a minute.'; route(); } catch (e) { fail(e); } };
  document.getElementById('df').onsubmit = (e) => {
    e.preventDefault(); const values = {};
    for (const f of fields) {
      const el = e.target.elements[f.key]; if (!el) continue;
      const cb = e.target.querySelector(`[data-use="${f.key}"]`);
      if (cb && !cb.checked) continue;
      values[f.key] = el.value;
    }
    send({ values });
  };
  document.getElementById('rs').onclick = () => confirm('Remove all design changes?') && send({ reset: true });
}

// ---------- settings / account / log ----------
async function viewSettings() {
  const s = await api('/settings');
  $app.innerHTML = `<div id="msg"></div><div class="card"><h3>Booking notification emails</h3>${s.mailConfigured ? '' : '<p class="err">Email is not set up yet: add the SMTP_* variables in Netlify (see README).</p>'}
  <p><small>Every new test booking and card application is saved in this panel AND emailed (with ID/photo attachments) to these addresses. Up to 5, separated by commas. Empty = booking@applyecscard.co.uk.</small></p>
  <form id="nf"><input class="full" name="notify" value="${esc(s.notify)}" placeholder="you@gmail.com, partner@gmail.com"><br><br><button>Save</button> <button name="test" value="1">Save + send test email</button></form></div>
  <div class="card"><h3>Customer auto-reply</h3><p><small>Customers who submit a booking or enquiry form receive a confirmation email straight away. In the text, {n} = name and {type} = form type.</small></p>
  <form id="ar"><p><label><input type="checkbox" name="on"${s.autoreply.on ? ' checked' : ''}> Auto-reply ON</label></p><p><input class="full" name="subject" value="${esc(s.autoreply.subject)}"></p><p><textarea class="full" name="body" rows="7">${esc(s.autoreply.body)}</textarea></p><button>Save auto-reply</button></form></div>
  <div class="card"><h3>Blocked IPs (spam shield)</h3><p><small>A blocked IP cannot submit forms, upload files or be tracked. The Live tab also has a "Block IP" button.</small></p><form id="bf"><input name="ip" placeholder="IP address" required> <input name="note" placeholder="Note (optional)"> <button>Block</button></form><div id="bl"></div></div>
  <div class="card"><h3>Backup</h3><p><small>Download all data (bookings, enquiries, cart, log) as a single JSON file.</small></p><a class="btn" href="/admin-api/backup.json">Download full backup</a></div>`;
  const drawBl = async () => { const l = await api('/blocked'); document.getElementById('bl').innerHTML = l.length ? `<table>${l.map((x) => `<tr><td>${esc(x.ip)}</td><td>${esc(x.note)}</td><td><small>${esc(fmt(x.at))}</small></td><td><button class="red" data-ip="${esc(x.ip)}">Unblock</button></td></tr>`).join('')}</table>` : '<p><small>No IPs blocked.</small></p>'; document.querySelectorAll('#bl [data-ip]').forEach((b) => (b.onclick = async () => { await api('/blocked', { method: 'POST', body: { action: 'remove', ip: b.dataset.ip } }); drawBl(); })); };
  drawBl();
  document.getElementById('bf').onsubmit = async (e) => { e.preventDefault(); try { await api('/blocked', { method: 'POST', body: { action: 'add', ip: e.target.ip.value.trim(), note: e.target.note.value } }); e.target.reset(); drawBl(); } catch (x) { document.getElementById('msg').innerHTML = msgBox(x.message, 1); } };
  document.getElementById('ar').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { const r = await api('/autoreply', { method: 'POST', body: { on: f.on.checked, subject: f.subject.value, body: f.body.value } }); document.getElementById('msg').innerHTML = msgBox(r.message); } catch (x) { document.getElementById('msg').innerHTML = msgBox(x.message, 1); }
  };
  document.getElementById('nf').onsubmit = async (e) => {
    e.preventDefault();
    const body = { notify: e.target.notify.value, test: e.submitter && e.submitter.name === 'test' };
    try { const r = await api('/settings', { method: 'POST', body }); document.getElementById('msg').innerHTML = msgBox(r.message); } catch (x) { document.getElementById('msg').innerHTML = msgBox(x.message, 1); }
  };
}
async function viewAccount() {
  const a = await api('/account');
  $app.innerHTML = `<div id="msg"></div><div class="card" style="max-width:480px"><h3>Admin login details</h3><form id="af">
  <p>Admin email<br><input class="full" type="email" name="email" value="${esc(a.email)}" required></p>
  <p>Current password<br><input class="full" type="password" name="current" required></p>
  <p>New password (leave empty to keep, min 10 chars)<br><input class="full" type="password" name="new"></p>
  <p>Repeat new password<br><input class="full" type="password" name="new2"></p><button>Save</button></form></div>`;
  document.getElementById('af').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/account', { method: 'POST', body: form(e.target) }); document.getElementById('msg').innerHTML = msgBox(r.message); e.target.reset(); } catch (x) { document.getElementById('msg').innerHTML = msgBox(x.message, 1); }
  };
}
async function viewLog() {
  const rows = await api('/log');
  $app.innerHTML = `<div class="card wrap"><h3>Activity log (last 300)</h3><table><tr><th>Time</th><th>IP</th><th>Action</th><th>Details</th></tr>${rows.map((r) => `<tr><td>${esc(fmt(r.ts))}</td><td>${esc(r.ip)}</td><td>${esc(r.action)}</td><td>${esc(r.detail)}</td></tr>`).join('') || '<tr><td colspan="4">Nothing yet.</td></tr>'}</table></div>`;
}

route();


// ---------- blogs: add / edit / make live / hide / delete ----------
// draft = never visible | live = visible on /blog | hidden = switched off again
const loadCourses = () => new Promise((res) => {
  if (window.ECS_COURSES) return res(window.ECS_COURSES);
  const sc = document.createElement('script'); sc.src = '/courses-data.js';
  sc.onload = () => res(window.ECS_COURSES || []); sc.onerror = () => res([]); document.head.appendChild(sc);
});
const blogTag = (st) => st === 'published' ? '<span class="tag" style="background:#d4f3d4">LIVE</span>' : st === 'hidden' ? '<span class="tag" style="background:#fbd5d0">Hidden</span>' : '<span class="tag" style="background:#eee">Draft (not live)</span>';
async function viewBlogs() {
  const rows = await api('/blogs');
  if (blogEdit !== null) return viewBlogForm(rows.find((r) => r.id === blogEdit) || null);
  const live = rows.filter((r) => r.status === 'published').length;
  $app.innerHTML = `${msgBox(flash)}<div class="card wrap"><h3>Blogs (${rows.length}) &middot; Live: ${live} <button id="nb" style="float:right">+ New blog</button></h3>
  <p><small><b>Draft / Hidden</b> = not visible to visitors (a direct link also shows 404). A post appears on the site at <code>/blog</code> only after you click <b>Make live</b>. <b>Hide</b> switches it off again. Preview is visible only to you (after logging in).</small></p>
  <table><tr><th>Title</th><th>Status</th><th>Course link</th><th>Date</th><th></th></tr>
  ${rows.map((r) => `<tr><td><b>${esc(r.title)}</b><br><small>/blog/${esc(r.slug)}</small></td><td>${blogTag(r.status)}</td><td><small>${esc(r.course_name) || '-'}</small></td><td><small>${esc(fmt(r.published_at || r.created))}</small></td>
  <td style="white-space:nowrap">${r.status === 'published' ? `<button class="red" data-st="hidden" data-id="${r.id}">Hide</button>` : `<button data-st="published" data-id="${r.id}" style="background:#27ae60">Make live</button>`}
  <button data-edit="${r.id}">Edit</button> <a class="btn" style="background:#777" target="_blank" rel="noopener" href="/blog/${esc(r.slug)}">${r.status === 'published' ? 'View' : 'Preview'}</a> <button class="red" data-del="${r.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="5">No blogs.</td></tr>'}</table></div>`;
  flash = '';
  document.getElementById('nb').onclick = () => { blogEdit = 0; route(); };
  $app.querySelectorAll('button[data-edit]').forEach((b) => (b.onclick = () => { blogEdit = +b.dataset.edit; route(); }));
  $app.querySelectorAll('button[data-st]').forEach((b) => (b.onclick = async () => {
    try { await api('/blogs/' + b.dataset.id, { method: 'POST', body: { status: b.dataset.st } }); flash = b.dataset.st === 'published' ? 'Blog is now LIVE.' : 'Blog has been hidden.'; route(); } catch (e) { fail(e); }
  }));
  $app.querySelectorAll('button[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete this blog permanently? (To switch it off only, use Hide instead.)')) return;
    try { await api('/blogs/' + b.dataset.del, { method: 'DELETE' }); flash = 'Blog deleted.'; route(); } catch (e) { fail(e); }
  }));
}
async function viewBlogForm(r) {
  const courses = await loadCourses(), isNew = !r; r = r || { title: '', slug: '', excerpt: '', content: '', course_id: '', course_name: '', course_url: '', status: 'draft' };
  $app.innerHTML = `<div class="card"><h3>${isNew ? 'New blog' : 'Edit blog'} ${isNew ? '' : blogTag(r.status)}</h3>
  <form id="bf"><p>Title<br><input class="full" name="title" value="${esc(r.title)}" required maxlength="200"></p>
  <p>URL slug <small>(leave blank to generate it from the title)</small><br><input class="full" name="slug" value="${esc(r.slug)}" maxlength="80" placeholder="my-blog-title"></p>
  <p>Short summary (blog list + Google description)<br><textarea class="full" name="excerpt" rows="2" maxlength="400">${esc(r.excerpt)}</textarea></p>
  <p>Related course / test (a button will appear below the blog)<br><select name="course_pick" class="full"><option value="">- none / custom -</option>${courses.map((c) => `<option value="${esc(c.id)}"${c.id === r.course_id ? ' selected' : ''}>${esc(c.type)} - ${esc(c.name)}</option>`).join('')}</select></p>
  <p style="display:flex;gap:8px"><input name="course_name" placeholder="Button heading, e.g. Apprentice Card" value="${esc(r.course_name)}" style="flex:1"><input name="course_url" placeholder="page, e.g. ecs-apprentice-card.html" value="${esc(r.course_url)}" style="flex:1"></p>
  <p>Content<br><textarea class="full" name="content" rows="18">${esc(r.content)}</textarea>
  <small>Format: <code>## Heading</code>, <code>- bullet</code>, blank line = new paragraph, <code>**bold**</code>, <code>[text](link)</code>. Or paste full HTML (the first character must be <code>&lt;</code>).</small></p>
  <p><button name="act" value="save">Save${isNew ? ' as draft' : ''}</button> ${r.status !== 'published' ? '<button name="act" value="live" style="background:#27ae60">Save &amp; make live</button>' : ''} <button type="button" id="bc" style="background:#777">Cancel</button></p></form></div>`;
  const f = document.getElementById('bf');
  f.course_pick.onchange = () => { const c = courses.find((x) => x.id === f.course_pick.value); if (c) { f.course_name.value = c.name; f.course_url.value = c.url; } };
  document.getElementById('bc').onclick = () => { blogEdit = null; route(); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = form(f), body = { title: d.title, slug: d.slug || undefined, excerpt: d.excerpt, content: d.content, course_id: d.course_pick || '', course_name: d.course_name, course_url: d.course_url };
    if (!body.slug) delete body.slug;
    if (e.submitter && e.submitter.value === 'live') body.status = 'published';
    try { await api(isNew ? '/blogs' : '/blogs/' + r.id, { method: 'POST', body }); flash = body.status === 'published' ? 'Saved - blog is now LIVE.' : 'Saved.'; blogEdit = null; route(); } catch (x) { fail(x); }
  };
}

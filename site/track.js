// Sends "add to cart" and "checkout started" events to the admin panel (Admin > Cart) + email.
(function () {
  var EP = '/admin-api/cart-event';
  function getVid() {
    try { var v = localStorage.getItem('ecs_vid'); if (!v) { v = (Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 24); localStorage.setItem('ecs_vid', v); } return v; } catch (e) { return ''; }
  }
  function cartSnapshot() {
    var map = {}; (window.ECS_COURSES || []).forEach(function (c) { map[c.id] = c; });
    var a = ls('ecs_cart_v1').map(function (i) { return { id: i.id, name: i.name, price: i.price, qty: 1 }; });
    var b = ls('ecsCart').map(function (i) { var c = map[i.id] || {}; return { id: i.id, name: c.name || i.id, price: c.price || 0, qty: i.qty || 1 }; });
    return a.concat(b).slice(0, 20);
  }
  function send(p) {
    try {
      p.page = location.pathname; p.vid = getVid();
      var b = JSON.stringify(p);
      if (navigator.sendBeacon && navigator.sendBeacon(EP, new Blob([b], { type: 'application/json' }))) return;
      fetch(EP, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b, keepalive: true });
    } catch (e) {}
  }
  function ls(k) { try { var v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; }
  var okMail = function (m) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m); };

  // Contact / home enquiry form: attach visitor id + current cart so the enquiry email + Admin > Enquiries show what they added to cart
  document.addEventListener('submit', function (e) {
    try {
      var f = e.target;
      if (!f || f.tagName !== 'FORM' || !/admin-api\/enquiry|enquiry\.php/.test(f.getAttribute('action') || '')) return;
      [['_vid', getVid()], ['_cart', JSON.stringify(cartSnapshot())]].forEach(function (kv) {
        var i = f.querySelector('input[name="' + kv[0] + '"]');
        if (!i) { i = document.createElement('input'); i.type = 'hidden'; i.name = kv[0]; f.appendChild(i); }
        i.value = kv[1];
      });
    } catch (x) {}
  }, true);

  document.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    // courses.html / revision-training-courses.html: "Add to cart" button (class "in" = already in cart)
    var add = t.closest('[data-add]');
    if (add) {
      if (!add.classList.contains('in')) send({ kind: 'add_to_cart', id: add.dataset.add, name: add.dataset.name, price: parseFloat(add.dataset.price) || 0 });
      return;
    }
    // courses drawer checkout: name / email / phone + Pay
    if (t.closest('#co-pay')) {
      var n = val('co-name'), m = val('co-email');
      if (n.length > 1 && okMail(m)) send({ kind: 'checkout', items: ls('ecs_cart_v1'), name: n, email: m, phone: val('co-phone') });
      return;
    }
    // cart.html checkout
    if (t.closest('#pay')) {
      var nm = (val('fn') + ' ' + val('ln')).trim(), em = val('em'), map = {};
      (window.ECS_COURSES || []).forEach(function (c) { map[c.id] = c; });
      var items = ls('ecsCart').map(function (i) { var c = map[i.id] || {}; return { id: i.id, name: c.name || i.id, price: c.price || 0, qty: i.qty || 1 }; });
      if (nm.length > 2 && okMail(em)) send({ kind: 'checkout', items: items, name: nm, email: em, phone: val('ph') });
    }
  }, true);

  // pages that use cart.js addToCart(id)
  window.addEventListener('DOMContentLoaded', function () {
    if (typeof window.addToCart !== 'function' || window.addToCart.__tracked) return;
    var orig = window.addToCart;
    window.addToCart = function (id) {
      var was = typeof window.inCart === 'function' ? window.inCart(id) : false;
      var r = orig.apply(this, arguments);
      if (!was) { var c = (window.ECS_COURSES || []).filter(function (x) { return x.id === id; })[0] || {}; send({ kind: 'add_to_cart', id: id, name: c.name || id, price: c.price || 0 }); }
      return r;
    };
    window.addToCart.__tracked = true;
  });
})();

// ---- Admin > Header: hide menu links / texts / words (hide = gone, show = back) ----
(function () {
  var KEY = 'ecs_hide_cfg_v2', cfg = null, orig = new WeakMap(), styleEl = null;
  var norm = function (t) { return String(t || '').replace(/[\u25BE\u25BC\u2193]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); };
  var rx = function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  var nh = function (h) { return String(h || '').replace(/^https?:\/\/[^\/]+/i, '').replace(/[?#].*$/, '').replace(/^(\.\/|\/)+/, '').replace(/\/+$/, '').replace(/\.html$/i, '').toLowerCase(); };
  try { cfg = JSON.parse(localStorage.getItem(KEY)); } catch (e) { cfg = null; }

  function css() { // links hidden by CSS = no flicker, even before the header is loaded
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'ecs-hide-css'; (document.head || document.documentElement).appendChild(styleEl); }
    var out = [];
    ((cfg && cfg.href) || []).forEach(function (h) {
      var b = String(h).replace(/^https?:\/\/[^\/]+/i, '').replace(/^(\.\/|\/)+/, '').replace(/\.html$/i, '');
      if (!b || /["\\]/.test(b)) return;
      [h, b, b + '.html', '/' + b, '/' + b + '.html', './' + b + '.html'].forEach(function (v) { out.push('a[href="' + v + '"]'); });
    });
    styleEl.textContent = out.length ? out.join(',') + '{display:none!important}' + out.map(function (x) { return 'li:has(>' + x + ')'; }).join(',') + '{display:none!important}' : '';
  }
  function hide(el) { el.setAttribute('data-hid', '1'); el.style.setProperty('display', 'none', 'important'); }
  function run() {
    if (!cfg) return;
    var hrefs = {}, texts = cfg.text || [], words = (cfg.words || []).filter(Boolean);
    (cfg.href || []).forEach(function (h) { var n = nh(h); if (n && h !== '#') hrefs[n] = 1; });
    // 1) undo what we hid before (so "show" brings it back), then re-apply
    document.querySelectorAll('[data-hid]').forEach(function (e) { e.removeAttribute('data-hid'); e.style.removeProperty('display'); });
    // 2) links
    document.querySelectorAll('a[href]').forEach(function (a) {
      var n = nh(a.getAttribute('href'));
      if (!n || !hrefs[n]) return;
      var p = a.parentElement; hide(p && p.tagName === 'LI' && p.querySelector(':scope > a') === a ? p : a);
    });
    var roots = document.querySelectorAll('#header-container, #footer-container');
    roots.forEach(function (root) {
      // 3) texts (whole item, e.g. a dropdown group)
      if (texts.length) root.querySelectorAll('a,button,li,span,strong,p,h2,h3,h4,h5,h6,.nav-brand').forEach(function (e) {
        if (e.hasAttribute('data-hid')) return;
        var own = ''; e.childNodes.forEach(function (c) { if (c.nodeType === 3) own += c.nodeValue; });
        if (texts.indexOf(norm(e.textContent)) < 0 && !(norm(own) && texts.indexOf(norm(own)) >= 0)) return;
        var t = e, par = e.parentElement;
        if (e.classList.contains('accordion-header')) t = e.closest('.accordion-item') || e;
        else if (par && par.tagName === 'LI' && par.querySelector(':scope > a') === e) t = par;
        hide(t);
      });
      // 4) words (removed from any text; restored from the saved original when un-hidden)
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n, list = [];
      while ((n = w.nextNode())) if (!/^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName)) list.push(n);
      var re = words.length ? new RegExp(words.map(rx).join('|'), 'gi') : null;
      list.forEach(function (x) {
        if (!orig.has(x)) { if (!re || !re.test(x.nodeValue)) { if (re) re.lastIndex = 0; return; } re.lastIndex = 0; orig.set(x, x.nodeValue); }
        var o = orig.get(x), nv = re ? o.replace(re, '') : o;
        if (x.nodeValue !== nv) x.nodeValue = nv;
        var a = x.parentNode && x.parentNode.closest && x.parentNode.closest('a,button');
        if (a && re && !a.textContent.replace(/[\u25BE\u25BC\u2193\s]/g, '')) hide(a.closest('li') || a);
      });
    });
    // 5) empty groups disappear too (all links inside hidden)
    var empty = function (el) { var l = el.querySelectorAll('a[href]'); if (!l.length) return false; for (var i = 0; i < l.length; i++) { if (!l[i].closest('[data-hid]')) return false; } return true; };
    document.querySelectorAll('#header-container .accordion-item, #footer-container .accordion-item').forEach(function (g) { if (!g.hasAttribute('data-hid') && empty(g)) hide(g); });
    document.querySelectorAll('#header-container li.has-dropdown').forEach(function (g) { if (!g.hasAttribute('data-hid') && empty(g)) hide(g); });
  }
  var t; function later() { clearTimeout(t); t = setTimeout(run, 30); }
  css(); run();
  var start = function () { if (window.MutationObserver) new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true }); };
  if (document.documentElement) start();
  fetch('/admin-api/hidden', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) {
    cfg = { href: j.href || [], text: (j.text || []).map(norm), words: j.words || [] };
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {}
    css(); run();
  }).catch(function () {});
})();

// ---- Live visitor heartbeat + lead capture (Admin > Live) ----
(function () {
  var EP = '/admin-api/ping', vid;
  try { vid = localStorage.getItem('ecs_vid'); if (!vid) { vid = (Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 24); localStorage.setItem('ecs_vid', vid); } } catch (e) { vid = 'v' + Math.random().toString(36).slice(2, 14); }
  function ls(k) { try { var v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; }
  function cartNow() {
    var map = {}; (window.ECS_COURSES || []).forEach(function (c) { map[c.id] = c; });
    var a = ls('ecs_cart_v1').map(function (i) { return { id: i.id, name: i.name, price: i.price, qty: 1 }; });
    var b = ls('ecsCart').map(function (i) { var c = map[i.id] || {}; return { id: i.id, name: c.name || i.id, price: c.price || 0, qty: i.qty || 1 }; });
    return a.concat(b);
  }
  function q(sel) { var e = document.querySelector(sel); if (!e) return ''; var v = e.tagName === 'SELECT' && e.selectedIndex >= 0 && e.options[e.selectedIndex] ? (e.options[e.selectedIndex].value ? e.options[e.selectedIndex].text : '') : e.value; return String(v || '').replace(/\s+/g, ' ').trim(); }
  function lead() {
    var name = val('co-name') || (val('fn') + ' ' + val('ln')).trim() || q('[name=full_name]') || q('form [name=name]'), email = val('co-email') || val('em') || q('[name=email]'), phone = val('co-phone') || val('ph') || q('[name=mobile]') || q('form [name=phone]');
    return { name: name, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '', phone: phone };
  }
  function formInfo() { return { test: q('[name=test_type]'), centre: q('[name=test_centre]'), date: q('[name=test_date]'), card: q('[name=ecs_card_type]') }; }
  function activity(l, f, cart) {
    var p = location.pathname.toLowerCase();
    if (/book|ecscardbooking|ecs-test-booking/.test(p)) return (l.name || l.email || f.test || f.centre) ? 'Filling booking form' : 'On booking page';
    if (/cart|checkout/.test(p) || document.getElementById('co-pay')) return (l.name || l.email) ? 'Entering checkout details' : (cart.length ? 'Viewing cart' : 'Browsing courses');
    if (/contact/.test(p)) return q('form [name=message]') ? 'Writing an enquiry' : 'On contact page';
    return cart.length ? 'Browsing (items in cart)' : 'Browsing';
  }
  function ping() {
    try {
      var l = lead(), f = formInfo(), c = cartNow(), b = JSON.stringify({ vid: vid, page: location.pathname + location.search, title: document.title, ref: document.referrer ? new URL(document.referrer).hostname : '', cart: c, name: l.name, email: l.email, phone: l.phone, form: f, activity: activity(l, f, c) });
      if (navigator.sendBeacon && navigator.sendBeacon(EP, new Blob([b], { type: 'application/json' }))) return;
      fetch(EP, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b, keepalive: true });
    } catch (e) {}
  }
  ping();
  setInterval(function () { if (!document.hidden) ping(); }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) ping(); });
  var tm; document.addEventListener('input', function (e) {
    var t = e.target; if (t && (/^(co-name|co-email|co-phone|fn|ln|em|ph)$/.test(t.id) || /^(full_name|email|mobile|test_type|test_centre|test_date|ecs_card_type|name|phone)$/.test(t.name || ''))) { clearTimeout(tm); tm = setTimeout(ping, 1200); }
  }, true);
  document.addEventListener('change', function (e) { var t = e.target; if (t && /^(test_type|test_centre|test_date|ecs_card_type)$/.test(t.name || '')) { clearTimeout(tm); tm = setTimeout(ping, 600); } }, true);
  document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('[data-add],[data-remove],#cart-checkout,#co-pay,#pay')) setTimeout(ping, 400); }, true);
})();

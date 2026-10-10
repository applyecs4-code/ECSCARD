import assert from 'node:assert/strict';
process.env.SUPABASE_URL='http://x'; process.env.SUPABASE_SERVICE_KEY='k'; process.env.SESSION_SECRET='s'.repeat(40);
process.env.ADMIN_PASSWORD_HASH='pw'; process.env.SMTP_HOST='h'; process.env.SMTP_USER='u'; process.env.SMTP_PASS='p';
const { handler: api } = await import('../../api/admin-api.mjs');
const { sent } = await import('./mailer.mjs');
let n = 0;
const call = (path, { method='GET', body, headers={}, form } = {}) => api(new Request('https://x.test'+path, { method, headers: { ...(body?{'content-type':'application/json'}:{}), ...(form?{'content-type':'application/x-www-form-urlencoded'}:{}), ...headers }, body: body?JSON.stringify(body):form?new URLSearchParams(form):undefined }), { ip: '5.5.5.' + (++n) });
const login = await call('/admin-api/login', { method:'POST', body:{ email:'booking@applyecscard.co.uk', password:'pw' }});
assert.equal(login.status, 200);
const ck = login.headers.get('set-cookie').split(';')[0];
const adm = { cookie: ck, 'x-requested-with':'admin-panel' };

// 1. seeding: 10 drafts, only once
let list = await (await call('/admin-api/blogs', { headers: adm })).json();
assert.equal(list.length, 10); assert.ok(list.every(b => b.status === 'draft'));
list = await (await call('/admin-api/blogs', { headers: adm })).json(); assert.equal(list.length, 10);
console.log('1 seed ok: 10 drafts');

// 2. drafts are NOT public (index + direct link), admin can preview
let idx = await (await call('/blog'.replace('/blog','/admin-api/blog-index'))).text();
assert.ok(idx.includes('coming soon') && !idx.includes('What Is an ECS Card'));
const slug = list.find(b => /apprentice/.test(b.slug)).slug, id = list.find(b => b.slug === slug).id;
assert.equal((await call('/admin-api/blog-post/' + slug)).status, 404);
const pv = await call('/admin-api/blog-post/' + slug, { headers: { cookie: ck } });
assert.equal(pv.status, 200); assert.ok((await pv.text()).includes('Preview only'));
console.log('2 draft hidden from public, admin preview ok');

// 3. make live -> public; hide -> 404 again
let r = await call('/admin-api/blogs/' + id, { method:'POST', headers: adm, body:{ status:'published' }}); assert.equal(r.status, 200);
let page = await call('/admin-api/blog-post/' + slug); assert.equal(page.status, 200);
let html = await page.text();
assert.ok(html.includes('ECS Apprentice Card Explained') && html.includes('ecs-apprentice-card.html') && html.includes('index, follow') && !html.includes('Preview only'));
idx = await (await call('/admin-api/blog-index')).text(); assert.ok(idx.includes('ECS Apprentice Card Explained') && !idx.includes('Labourer Card: Who'));
const sm = await (await call('/admin-api/blog-sitemap')).text(); assert.ok(sm.includes('/blog/' + slug) && !sm.includes('labourer'));
r = await call('/admin-api/blogs/' + id, { method:'POST', headers: adm, body:{ status:'hidden' }});
assert.equal((await call('/admin-api/blog-post/' + slug)).status, 404);
idx = await (await call('/admin-api/blog-index')).text(); assert.ok(!idx.includes('ECS Apprentice Card Explained'));
console.log('3 make live / hide ok');

// 4. new blog defaults to draft; duplicate slug; XSS escaped; bad status; CSRF guard; delete
r = await call('/admin-api/blogs', { method:'POST', headers: adm, body:{ title:'My <b>Test</b> Post', content:'## Hi\n\n- a\n- b\n\n**bold** [x](javascript:alert(1)) <script>x</script>', excerpt:'e' }});
const nb = await r.json(); assert.equal(nb.status, 'draft'); assert.equal(nb.slug, 'my-b-test-b-post');
const dup = await (await call('/admin-api/blogs', { method:'POST', headers: adm, body:{ title:'My <b>Test</b> Post' }})).json(); assert.equal(dup.slug, 'my-b-test-b-post-2');
await call('/admin-api/blogs/' + nb.id, { method:'POST', headers: adm, body:{ status:'published' }});
html = await (await call('/admin-api/blog-post/' + nb.slug)).text();
assert.ok(!html.includes('<script>x</script>') && !html.includes('javascript:') && html.includes('<h2>Hi</h2>') && html.includes('<li>a</li>') && html.includes('<strong>bold</strong>'));
assert.equal((await call('/admin-api/blogs/' + nb.id, { method:'POST', headers: adm, body:{ status:'weird' }})).status, 400);
assert.equal((await call('/admin-api/blogs/' + nb.id, { method:'POST', headers: { cookie: ck }, body:{ status:'draft' }})).status, 400); // no CSRF header
assert.equal((await call('/admin-api/blogs/' + nb.id, { method:'POST', body:{ status:'published' }})).status, 401);
assert.equal((await call('/admin-api/blogs/' + nb.id, { method:'DELETE', headers: adm })).status, 200);
assert.equal((await call('/admin-api/blog-post/' + nb.slug)).status, 404);
console.log('4 draft default, escaping, guards, delete ok');

// 5. contact form + cart linked
sent.length = 0;
let e = await call('/admin-api/enquiry', { method:'POST', form:{ name:'Ravi', email:'ravi@x.co', phone:'0712345678', subject:'ecs-card', message:'Need help', _vid:'vid1234567890', _cart: JSON.stringify([{id:'ecs-apprentice-card',name:'Apprentice Card',price:79,qty:1}]) }});
assert.equal(e.status, 200); assert.ok((await e.text()).includes('Thank you'));
const em = sent.find(m => /New enquiry/.test(m.subject)); assert.ok(em && /\(\+ cart\)/.test(em.subject) && em.html.includes('Apprentice Card') && em.html.includes('79'));
globalThis.__db.enquiries[0].cart.length === 1 || assert.fail('cart not stored');
let c = await call('/admin-api/cart-event', { method:'POST', body:{ kind:'add_to_cart', id:'ecs-labourer-card', name:'Labourer Card', price:79, vid:'vid1234567890' }});
assert.equal(c.status, 200);
const ce = globalThis.__db.cart_events.at(-1); assert.equal(ce.email, 'ravi@x.co'); assert.equal(ce.name, 'Ravi');
assert.ok(sent.at(-1).html.includes('ravi@x.co') && /Ravi/.test(sent.at(-1).subject));
// cart first, contact form later
await call('/admin-api/cart-event', { method:'POST', body:{ kind:'add_to_cart', id:'a1', name:'Test Card', price:10, vid:'vidAAAAAAAAAA' }});
assert.ok(!globalThis.__db.cart_events.at(-1).email);
await call('/admin-api/enquiry', { method:'POST', form:{ name:'Sam', email:'sam@x.co', phone:'1', subject:'support', message:'hi', _vid:'vidAAAAAAAAAA', _cart:'[]' }});
assert.equal(globalThis.__db.cart_events.at(-1).email, 'sam@x.co');
console.log('5 contact form <-> cart linked (both orders) ok');

// 6. old tables without new columns still save, mail failure is logged
globalThis.__schema.enquiries = globalThis.__schema.enquiries.filter(k => k !== 'cart' && k !== 'vid');
globalThis.__mailFail = true;
e = await call('/admin-api/enquiry', { method:'POST', form:{ name:'Old', email:'old@x.co', phone:'1', subject:'support', message:'hello', _vid:'vidBBBBBBBBBB', _cart: JSON.stringify([{id:'q',name:'Q course',price:5,qty:1}]) }});
assert.equal(e.status, 200);
const saved = globalThis.__db.enquiries.at(-1); assert.equal(saved.email, 'old@x.co'); assert.ok(saved.message.includes('Q course'));
assert.ok(globalThis.__db.log.some(l => l.action === 'mail_failed'));
globalThis.__mailFail = false;
console.log('6 fallback save + mail_failed log ok');
// 7. setup SQL is served to the admin only
assert.equal((await call('/admin-api/setup-sql')).status, 401);
const sq = await call('/admin-api/setup-sql', { headers: adm }); assert.equal(sq.status, 200);
const sqt = await sq.text(); assert.ok(sqt.includes('create table if not exists cart_events') && sqt.includes('live_visitors') && sqt.includes('blogs'));
console.log('7 setup-sql ok');
console.log('ALL PASSED');

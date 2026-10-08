const SCHEMA = globalThis.__schema ??= {
  blogs: ['id','created','updated','published_at','slug','title','excerpt','content','course_id','course_name','course_url','status'],
  enquiries: ['id','created','status','name','email','phone','subject','message','cart','vid'],
  cart_events: ['id','created','kind','items','total','name','email','phone','page','ip','vid'],
  settings: ['key','value'], log: ['id','ts','ip','action','detail'], hits: ['ip','ts'], attempts: ['ip','ts'],
  live_visitors: ['vid','first_seen','last_seen','page','title','ref','device','city','country','ip','views','pages','cart','name','email','phone','activity','form'],
  bookings: ['id','created','status','type','full_name','email','mobile'],
};
const PK = { settings: 'key', live_visitors: 'vid' };
const DB = globalThis.__db ??= {};
let seq = 0;
const tbl = (t) => (DB[t] ??= []);
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; }
  select(c, o) { if (this.op === 'select') this.op = 'select'; this.cnt = o?.count; this.head = o?.head; this.ret = true; return this; }
  insert(v) { this.op = 'insert'; this.v = v; return this; }
  upsert(v, o) { this.op = 'upsert'; this.v = v; this.o = o || {}; return this; }
  update(v) { this.op = 'update'; this.v = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(k, v) { this.f.push((r) => r[k] === v); return this; }
  neq(k, v) { this.f.push((r) => r[k] !== v); return this; }
  gte(k, v) { this.f.push((r) => String(r[k]) >= String(v)); return this; }
  lt(k, v) { this.f.push((r) => String(r[k]) < String(v)); return this; }
  or(s) { const ps = s.split(','); this.f.push((r) => ps.some((p) => { const [k, op, ...rest] = p.split('.'); const val = rest.join('.'); if (op === 'is') return r[k] == null; if (op === 'eq') return String(r[k] ?? '') === val; return false; })); return this; }
  order(k, o) { this.ord = [k, o?.ascending !== false]; return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.sg = 'maybe'; return this; }
  single() { this.sg = 'one'; return this; }
  then(a, b) { return Promise.resolve(this.run()).then(a, b); }
  run() {
    const cols = SCHEMA[this.t]; if (!cols) return { data: null, error: { message: 'no table ' + this.t } };
    const rows = tbl(this.t), err = (m) => ({ data: null, error: { message: m } });
    const check = (o) => { for (const k of Object.keys(o)) if (!cols.includes(k)) return `Could not find the '${k}' column of '${this.t}'`; };
    const mk = (o) => { const r = { ...o }; if (cols.includes('id') && r.id == null) r.id = ++seq; if (cols.includes('created') && !r.created) r.created = new Date().toISOString(); if (this.t === 'blogs') { r.status ??= 'draft'; if (!['draft','published','hidden'].includes(r.status)) return null; if (rows.some((x) => x.slug === r.slug)) return null; } return r; };
    let out;
    if (this.op === 'insert' || this.op === 'upsert') {
      const arr = Array.isArray(this.v) ? this.v : [this.v]; out = [];
      for (const o of arr) {
        const e = check(o); if (e) return err(e);
        if (this.op === 'upsert') { const pk = this.o.onConflict || PK[this.t]; const ex = rows.find((x) => x[pk] === o[pk]); if (ex) { if (!this.o.ignoreDuplicates) Object.assign(ex, o); out.push(ex); continue; } }
        const r = mk(o); if (!r) return err('constraint violation on ' + this.t); rows.push(r); out.push(r);
      }
    } else {
      let m = rows.filter((r) => this.f.every((fn) => fn(r)));
      if (this.op === 'update') { const e = check(this.v); if (e) return err(e); m.forEach((r) => Object.assign(r, this.v)); out = m; }
      else if (this.op === 'delete') { for (const r of m) rows.splice(rows.indexOf(r), 1); out = m; }
      else { if (this.ord) m = [...m].sort((a, b) => (a[this.ord[0]] > b[this.ord[0]] ? 1 : -1) * (this.ord[1] ? 1 : -1)); if (this.lim) m = m.slice(0, this.lim); out = m; }
    }
    if (this.head) return { data: null, count: out.length, error: null };
    const res = { error: null }; if (this.cnt) res.count = out.length;
    if (this.sg === 'maybe') res.data = out[0] ?? null; else if (this.sg === 'one') { if (!out[0]) return err('no rows'); res.data = out[0]; } else res.data = out;
    return res;
  }
}
export const createClient = () => ({ from: (t) => new Q(t), storage: { from: () => ({}) } });

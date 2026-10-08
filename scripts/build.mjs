// Runs on every Netlify deploy:
//  1. copies site/ -> dist/ and admin-ui/ -> dist/admin/
//  2. adds <link rel="stylesheet" href="/site-custom.css"> to every root .html page (Design feature hook)
//  3. writes dist/admin/pages-index.json (list of pages for Admin > Pages)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'site'), UI = path.join(root, 'admin-ui'), OUT = path.join(root, 'dist');
const PARTIALS = ['header', 'footer'];
const PROTECTED = ['index', 'header', 'footer'];
const TAG = '<link rel="stylesheet" href="/site-custom.css">';
const TRACK = '<script src="/track.js" defer></script>'; // add-to-cart / checkout tracking -> Admin > Cart

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });
fs.cpSync(UI, path.join(OUT, 'admin'), { recursive: true });

const pages = [];
for (const f of fs.readdirSync(OUT)) {
  if (!f.endsWith('.html')) continue;
  const slug = f.slice(0, -5), file = path.join(OUT, f);
  if (PARTIALS.includes(slug)) continue;
  let html = fs.readFileSync(file, 'utf8');
  const m = html.slice(0, 6000).match(/<title>([\s\S]*?)<\/title>/i);
  pages.push({ slug, title: m ? m[1].replace(/\s+/g, ' ').trim() : '', locked: PROTECTED.includes(slug) });
  let changed = false;
  if (!html.includes('site-custom.css') && /<\/head>/i.test(html)) { html = html.replace(/<\/head>/i, `${TAG}\n</head>`); changed = true; }
  if (!html.includes('/track.js') && /<\/head>/i.test(html)) { html = html.replace(/<\/head>/i, `${TRACK}\n</head>`); changed = true; }
  if (changed) fs.writeFileSync(file, html);
}
pages.sort((a, b) => a.slug.localeCompare(b.slug));
fs.writeFileSync(path.join(OUT, 'admin', 'pages-index.json'), JSON.stringify(pages));
console.log(`build ok: ${pages.length} pages indexed`);

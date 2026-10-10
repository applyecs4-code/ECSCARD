// Blog helpers: slug, simple markdown-lite renderer and the public page templates.
import { esc } from './core.mjs';

export const SITE = (process.env.SITE_URL || 'https://applyecscard.co.uk').replace(/\/+$/, '');
export const BLOG_STATUSES = ['draft', 'published', 'hidden'];

export const slugify = (t) => String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
export const safeLink = (u) => (/^(https?:\/\/[^\s"'<>]+|\/[A-Za-z0-9._~\/#?&=%-]*|[A-Za-z0-9_-]+(\.html)?(#[A-Za-z0-9_-]*)?)$/.test(u) ? u : '#');
export const safeCourseUrl = (u) => (/^[A-Za-z0-9._\/-]{0,200}$/.test(String(u || '')) ? String(u || '').replace(/^\/+/, '') : '');

function inline(s) {
  let t = esc(s);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, a, u) => `<a href="${esc(safeLink(u.replace(/&amp;/g, '&')))}">${a}</a>`);
  return t;
}
// Content: if it starts with "<" it is treated as HTML (admin-written). Otherwise markdown-lite.
export function renderBody(text) {
  const t = String(text || '').replace(/\r/g, '').trim();
  if (/^</.test(t)) return t;
  return t.replace(/^(#{2,3} .+)$/gm, '\n$1\n').split(/\n{2,}/).map((b) => {
    b = b.trim(); if (!b) return '';
    if (/^### /.test(b)) return `<h3>${inline(b.slice(4))}</h3>`;
    if (/^## /.test(b)) return `<h2>${inline(b.slice(3))}</h2>`;
    const lines = b.split('\n');
    if (lines.every((l) => /^[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
    if (lines.every((l) => /^\d+\. /.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
}

const CSS = `
.blog-wrap{max-width:900px;margin:2rem auto;padding:0 16px;font-family:"Helvetica Neue",Arial,sans-serif;color:#333}
.blog-wrap h1{font-size:2.1rem;color:#005BAC;margin:.4em 0 .3em;line-height:1.25}
.blog-wrap h2{color:#005BAC;margin:1.6em 0 .5em}.blog-wrap h3{margin:1.3em 0 .4em}
.blog-wrap p,.blog-wrap li{line-height:1.75;font-size:1.05rem}.blog-wrap ul,.blog-wrap ol{padding-left:1.4em}
.blog-meta{color:#777;font-size:.9rem;margin-bottom:1.2rem}
.blog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:18px;margin-top:1.4rem}
.blog-card{background:#fff;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.08);padding:18px;display:flex;flex-direction:column}
.blog-card h2{font-size:1.15rem;margin:0 0 .5rem;color:#005BAC}.blog-card h2 a{color:inherit;text-decoration:none}
.blog-card p{font-size:.95rem;color:#555;flex:1;margin:0 0 .8rem}.blog-card .more{color:#0072CE;font-weight:600;text-decoration:none}
.blog-cta{background:#eef5fc;border-left:5px solid #0072CE;border-radius:8px;padding:16px 18px;margin:2rem 0}
.blog-cta a.btn{display:inline-block;background:#0072CE;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;margin:6px 8px 0 0}
.blog-note{font-size:.85rem;color:#777;border-top:1px solid #eee;padding-top:12px;margin-top:2rem}
.blog-preview{background:#fff3cd;border:1px solid #ffe08a;padding:10px 14px;border-radius:6px;margin-bottom:1rem;font-size:.95rem}
.blog-crumb{font-size:.9rem}.blog-crumb a{color:#0072CE;text-decoration:none}
`;
function shell({ title, desc, canonical, robots, ld, body }) {
  return `<!DOCTYPE html><html lang="en-GB"><head><meta charset="UTF-8"><base href="/"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="${robots}">
<link rel="canonical" href="${esc(canonical)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="article"><meta property="og:url" content="${esc(canonical)}">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}
<style>${CSS}</style><link rel="stylesheet" href="/site-custom.css"><script src="/track.js" defer></script></head>
<body><div id="header-container"></div><script src="cart.js"></script><script src="courses-data.js"></script><script src="header.js"></script>
${body}</body></html>`;
}
const dfmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }) : '');

export function indexPage(posts) {
  const cards = posts.map((p) => `<article class="blog-card"><h2><a href="blog/${esc(p.slug)}">${esc(p.title)}</a></h2><p>${esc(p.excerpt)}</p><a class="more" href="blog/${esc(p.slug)}">Read more &rarr;</a></article>`).join('');
  const body = `<main class="blog-wrap"><h1>ECS Card &amp; Test Blog</h1><p>Guides and tips for ECS cards, health and safety assessments and test bookings.</p>${cards ? `<div class="blog-grid">${cards}</div>` : '<p>New articles are coming soon.</p>'}</main>`;
  return shell({ title: 'ECS Card & Test Blog | Apply ECS', desc: 'Guides and tips for ECS cards, ECS health and safety assessments and ECS test bookings in the UK.', canonical: SITE + '/blog', robots: posts.length ? 'index, follow' : 'noindex, follow', body });
}
export function postPage(p, { preview = false } = {}) {
  const url = `${SITE}/blog/${p.slug}`;
  const cta = (p.course_url || p.course_name) ? `<div class="blog-cta"><strong>${p.course_id ? 'Related course' : 'Next step'}: ${esc(p.course_name || 'Apply ECS')}</strong><br>${p.course_url ? `<a class="btn" href="${esc(safeCourseUrl(p.course_url))}">View details &amp; book</a>` : ''}<a class="btn" href="courses.html" style="background:#005BAC">All courses</a><a class="btn" href="contact.html" style="background:#555">Ask us a question</a></div>` : '';
  const ld = { '@context': 'https://schema.org', '@type': 'Article', headline: p.title, description: p.excerpt, datePublished: p.published_at || p.created, dateModified: p.updated || p.published_at || p.created, mainEntityOfPage: url, publisher: { '@type': 'Organization', name: 'Apply ECS' } };
  const body = `<main class="blog-wrap">${preview ? `<div class="blog-preview"><b>Preview only</b> - this post is <b>${esc(p.status)}</b>, visitors cannot see it. Make it live from Admin &gt; Blogs.</div>` : ''}
<p class="blog-crumb"><a href="/">Home</a> / <a href="blog">Blog</a></p><h1>${esc(p.title)}</h1><p class="blog-meta">${esc(dfmt(p.published_at || p.created))}</p>
<article>${renderBody(p.content)}</article>${cta}
<p class="blog-note">Information is for general guidance only. Card and test requirements can change, so always check the latest rules with the ECS scheme before you apply.</p></main>`;
  return shell({ title: `${p.title} | Apply ECS`, desc: p.excerpt, canonical: url, robots: preview ? 'noindex, nofollow' : 'index, follow', ld, body });
}
export function sitemapXml(posts) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE}/blog</loc></url>${posts.map((p) => `<url><loc>${SITE}/blog/${esc(p.slug)}</loc><lastmod>${esc(String(p.updated || p.published_at || p.created).slice(0, 10))}</lastmod></url>`).join('')}</urlset>`;
}

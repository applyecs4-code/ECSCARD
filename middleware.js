// Vercel Routing Middleware (replaces Netlify edge function hide-pages.mjs).
// Runs before every page request: pages hidden / deleted in Admin > Pages answer 404.
// The list comes from Supabase (settings table) and is cached for 20 seconds per instance.
import { next } from '@vercel/functions/middleware';

let cache = { t: 0, set: new Set() };

async function load() {
  if (Date.now() - cache.t < 20000) return cache.set;
  try {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
    if (url && key) {
      const r = await fetch(`${url}/rest/v1/settings?key=in.(hidden,deleted)&select=key,value`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (r.ok) {
        const set = new Set();
        for (const row of await r.json()) if (Array.isArray(row.value)) row.value.forEach((s) => set.add(String(s)));
        cache = { t: Date.now(), set };
      }
    }
  } catch (_) { /* fail open: keep serving the site */ }
  cache.t = cache.t || Date.now();
  return cache.set;
}

export default async function middleware(request) {
  const path = new URL(request.url).pathname;
  if (/\.[a-z0-9]+$/i.test(path) && !path.endsWith('.html')) return next(); // assets: untouched
  const slug = path.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
  if (!slug || slug === 'admin' || slug.startsWith('admin/') || slug.startsWith('admin-api') || slug.startsWith('api/')) return next();
  if ((await load()).has(slug)) {
    return new Response('<!DOCTYPE html><title>404</title><h1>404 - Page not found</h1>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  return next();
}

export const config = { matcher: ['/((?!admin/|admin-api/|api/|_vercel/).*)'] };

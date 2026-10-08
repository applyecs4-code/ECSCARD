-- Run ONCE in Supabase > SQL Editor (Live visitors tab)

-- live visitor tracking
create table if not exists live_visitors (
  vid text primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  page text, title text, ref text, device text, city text, country text, ip text,
  views int not null default 1,
  pages jsonb not null default '[]'::jsonb,
  cart jsonb not null default '[]'::jsonb,
  name text, email text, phone text
);
create index if not exists live_visitors_seen_idx on live_visitors(last_seen desc);
alter table live_visitors enable row level security;

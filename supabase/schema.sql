-- Run this ONCE in Supabase > SQL Editor > New query
create table if not exists bookings (
  id bigint generated always as identity primary key,
  created timestamptz not null default now(),
  status text not null default 'New',
  type text default 'Test booking',
  card_type text, full_name text, dob text, ni text, gender text,
  address text, city text, postcode text, mobile text, email text,
  test_type text, language text, centre text, test_date text, test_time text,
  id_file text default '', photo_file text default '', file3 text default '',
  extra jsonb default '{}'::jsonb,
  notes text not null default ''
);
create index if not exists bookings_created_idx on bookings(created desc);

create table if not exists enquiries (
  id bigint generated always as identity primary key,
  created timestamptz not null default now(),
  status text not null default 'New',
  name text, email text, phone text, subject text, message text
);

create table if not exists log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  ip text, action text, detail text
);

-- rate limiting (login attempts + public form hits)
create table if not exists attempts (ip text not null, ts timestamptz not null default now());
create table if not exists hits     (ip text not null, ts timestamptz not null default now());
create index if not exists attempts_ip_idx on attempts(ip, ts);
create index if not exists hits_ip_idx on hits(ip, ts);

-- key/value settings: hidden, deleted, design, notify, admin
create table if not exists settings (key text primary key, value jsonb not null);

-- Lock every table: only the server (service_role key) can touch them. No public/anon access.
alter table bookings  enable row level security;
alter table enquiries enable row level security;
alter table log       enable row level security;
alter table attempts  enable row level security;
alter table hits      enable row level security;
alter table settings  enable row level security;

-- Private bucket for ID / photo / H&S documents (15 MB max, images + PDF only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 15728640,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false,
  file_size_limit = 15728640,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

-- cart tracking (add to cart / checkout started)
create table if not exists cart_events (
  id bigint generated always as identity primary key,
  created timestamptz not null default now(),
  kind text not null default 'add_to_cart',
  items jsonb not null default '[]'::jsonb,
  total numeric default 0,
  name text, email text, phone text, page text, ip text
);
create index if not exists cart_events_created_idx on cart_events(created desc);
alter table cart_events enable row level security;

-- live visitor tracking
create table if not exists live_visitors (
  vid text primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  page text, title text, ref text, device text, city text, country text, ip text,
  views int not null default 1,
  pages jsonb not null default '[]'::jsonb,
  cart jsonb not null default '[]'::jsonb,
  name text, email text, phone text,
  activity text default '', form jsonb not null default '{}'::jsonb
);
create index if not exists live_visitors_seen_idx on live_visitors(last_seen desc);
alter table live_visitors enable row level security;

create index if not exists bookings_email_idx on bookings(lower(email));
create index if not exists enquiries_email_idx on enquiries(lower(email));

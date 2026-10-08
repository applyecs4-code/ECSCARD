-- Supabase > SQL Editor > New query > paste the whole file > Run.  (Safe: running it again does no harm)

-- 1) Cart tab
create table if not exists cart_events (
  id bigint generated always as identity primary key,
  created timestamptz not null default now(),
  kind text not null default 'add_to_cart',
  items jsonb not null default '[]'::jsonb,
  total numeric default 0,
  name text, email text, phone text, page text, ip text
);
alter table cart_events add column if not exists vid text;
create index if not exists cart_events_created_idx on cart_events(created desc);
create index if not exists cart_events_vid_idx on cart_events(vid);
alter table cart_events enable row level security;

-- 2) Live tab
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
alter table live_visitors add column if not exists activity text default '';
alter table live_visitors add column if not exists form jsonb not null default '{}'::jsonb;
create index if not exists live_visitors_seen_idx on live_visitors(last_seen desc);
alter table live_visitors enable row level security;

-- 3) Enquiry <-> cart link
alter table enquiries add column if not exists cart jsonb not null default '[]'::jsonb;
alter table enquiries add column if not exists vid text;
create index if not exists enquiries_vid_idx on enquiries(vid);
create index if not exists bookings_email_idx on bookings(lower(email));
create index if not exists enquiries_email_idx on enquiries(lower(email));

-- 4) Blogs
create table if not exists blogs (
  id bigint generated always as identity primary key,
  created timestamptz not null default now(),
  updated timestamptz not null default now(),
  published_at timestamptz,
  slug text not null unique,
  title text not null,
  excerpt text not null default '',
  content text not null default '',
  course_id text not null default '',
  course_name text not null default '',
  course_url text not null default '',
  status text not null default 'draft' check (status in ('draft','published','hidden'))
);
create index if not exists blogs_status_idx on blogs(status, published_at desc);
alter table blogs enable row level security;

-- 5) Make Supabase see the new tables (fixes the "schema cache" error)
notify pgrst, 'reload schema';

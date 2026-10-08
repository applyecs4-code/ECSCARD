-- Run ONCE in Supabase > SQL Editor (safe to run again). Blogs are managed in Admin > Blogs.
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
  -- draft = never shown to visitors | published = live | hidden = was live, now switched off
  status text not null default 'draft' check (status in ('draft','published','hidden'))
);
create index if not exists blogs_status_idx on blogs(status, published_at desc);
alter table blogs enable row level security;  -- only the server (service_role) can read/write

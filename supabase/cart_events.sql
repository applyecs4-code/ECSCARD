-- Run ONCE in Supabase > SQL Editor (only needed if you already ran schema.sql earlier)

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

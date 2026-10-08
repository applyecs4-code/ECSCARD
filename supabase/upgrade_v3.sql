-- Run ONCE in Supabase > SQL Editor (safe to run again).
-- Links contact enquiries with what the visitor added to the cart.
alter table enquiries   add column if not exists cart jsonb not null default '[]'::jsonb;
alter table enquiries   add column if not exists vid  text;
alter table cart_events add column if not exists vid  text;
create index if not exists enquiries_vid_idx   on enquiries(vid);
create index if not exists cart_events_vid_idx on cart_events(vid);

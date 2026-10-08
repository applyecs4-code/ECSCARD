-- Run ONCE in Supabase > SQL Editor (safe to run again).
-- Adds "what is the visitor doing / which test are they choosing" to the Live tab.
alter table live_visitors add column if not exists activity text default '';
alter table live_visitors add column if not exists form jsonb not null default '{}'::jsonb;
-- faster Customers / Leads lookups
create index if not exists bookings_email_idx on bookings(lower(email));
create index if not exists enquiries_email_idx on enquiries(lower(email));

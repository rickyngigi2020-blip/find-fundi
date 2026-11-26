-- Version 1.7, from a tester's feedback. Run after 0026. It only adds things,
-- so the live site keeps working on the old code until 1.7 is deployed.
-- Safe to run again: everything is "if not exists", so a second run changes
-- nothing. (The first version of this file stopped with "column
-- requested_rate_id of relation jobs already exists" when run twice.)
--
-- 1. The service a customer picks while booking. Kept apart from
--    jobs.service_rate_id, which the quotation sets and which is cleared when a
--    fundi turns the job down, so the customer's choice survives a change of fundi.
-- 2. Testimonials typed in by admins, from real people who agreed to be quoted.
--
-- The panic button moved to 1.8 (migration 0028). Its panic_alerts table may
-- already exist from an earlier version of this file; it sits unused until 1.8.

-- ---------- 1. the service picked at booking ----------
alter table jobs
  add column if not exists requested_rate_id uuid references service_rates(id) on delete set null,
  add column if not exists requested_service_name text,
  -- The price shown to the customer when they booked, so a later change to the
  -- menu does not change what they were told.
  add column if not exists requested_price_kes integer check (requested_price_kes is null or requested_price_kes > 0);

-- ---------- 2. testimonials ----------
create table if not exists testimonials (
  id uuid primary key default gen_random_uuid(),
  person_name text not null check (char_length(person_name) between 2 and 60),
  role text not null check (role in ('customer', 'fundi')),
  area text check (area is null or char_length(area) <= 60),
  quote text not null check (char_length(quote) between 10 and 400),
  -- The admin confirmed the person agreed to be quoted, in their own words.
  -- A testimonial cannot exist without it.
  consent_confirmed boolean not null check (consent_confirmed),
  published boolean not null default false,
  sort integer not null default 0,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- The home page reads published ones through the API, never directly.
alter table testimonials enable row level security;
revoke all on testimonials from anon, authenticated;

-- ---------- check ----------
-- All good: requested_columns = 3, testimonials_table = true.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs'
      and column_name in ('requested_rate_id', 'requested_service_name', 'requested_price_kes')) as requested_columns,
  to_regclass('public.testimonials') is not null as testimonials_table;

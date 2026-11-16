-- Fixed-rate services: a menu of common jobs with a set price per trade,
-- managed by admins. After a fundi takes a job they pick the matching service
-- and the price fills in. A job that is not on the menu keeps the free quote.
-- Nothing is seeded: the first figures are entered by an admin once they have
-- been checked with real fundis.

create table service_rates (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in (
    'phone_electronics', 'computer_laptop', 'appliance', 'mechanical',
    'general_maintenance', 'installation', 'tailoring'
  )),
  name text not null check (char_length(name) between 2 and 120),
  price_kes integer not null check (price_kes > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, name)
);

-- Only the API (service role) reads or writes rates, as with jobs.
alter table service_rates enable row level security;

-- Which listed service a job's price came from, and its name as it was when
-- the price was set, so renaming a service later does not rewrite old jobs.
alter table jobs add column service_rate_id uuid references service_rates(id) on delete set null;
alter table jobs add column service_name text;

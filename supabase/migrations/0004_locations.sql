-- Live location tracking for the customer/fundi map view.

alter table jobs add column customer_lat double precision;
alter table jobs add column customer_lng double precision;

create table fundi_locations (
  fundi_id uuid primary key references profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now()
);

alter table fundi_locations enable row level security;

create policy "fundi_locations: fundi upserts own"
  on fundi_locations for insert
  with check (auth.uid() = fundi_id);

create policy "fundi_locations: fundi updates own"
  on fundi_locations for update
  using (auth.uid() = fundi_id);

create policy "fundi_locations: fundi reads own"
  on fundi_locations for select
  using (auth.uid() = fundi_id);

-- A customer can see a fundi's live location only while that fundi is
-- matched to one of the customer's own active (matched/in_progress) jobs.
create policy "fundi_locations: customer reads matched fundi's location"
  on fundi_locations for select
  using (
    exists (
      select 1 from jobs j
      where j.fundi_id = fundi_locations.fundi_id
        and j.customer_id = auth.uid()
        and j.status in ('matched', 'in_progress')
    )
  );

-- Required for the customer's browser to receive live pushes when a fundi's
-- location row changes (Supabase Realtime only streams tables added here).
alter publication supabase_realtime add table fundi_locations;

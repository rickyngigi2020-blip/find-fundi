-- Find Fundi — initial schema
-- Run this once in the Supabase SQL editor for a new project.

create extension if not exists "pgcrypto";

-- ============ profiles ============
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text not null,
  role text not null check (role in ('customer', 'fundi')),
  area text,
  street text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles: read own"
  on profiles for select
  using (auth.uid() = id);

create policy "profiles: insert own"
  on profiles for insert
  with check (auth.uid() = id);

create policy "profiles: update own"
  on profiles for update
  using (auth.uid() = id);

-- ============ fundi_profiles ============
create table fundi_profiles (
  id uuid primary key references profiles(id) on delete cascade,
  category text not null check (category in (
    'phone_electronics', 'computer_laptop', 'mechanical', 'appliance', 'electrical'
  )),
  national_id text not null,
  highest_qualification text not null,
  years_experience text not null,
  id_document_url text not null,
  certificate_url text,
  bio text,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table fundi_profiles enable row level security;

create policy "fundi_profiles: read own"
  on fundi_profiles for select
  using (auth.uid() = id);

create policy "fundi_profiles: read verified (for matching)"
  on fundi_profiles for select
  using (verification_status = 'verified');

create policy "fundi_profiles: insert own"
  on fundi_profiles for insert
  with check (auth.uid() = id);

create policy "fundi_profiles: update own"
  on fundi_profiles for update
  using (auth.uid() = id);

-- ============ jobs ============
create table jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  fundi_id uuid references profiles(id) on delete set null,
  category text not null,
  subcategory text,
  description text not null,
  photo_url text,
  urgency text not null default 'normal' check (urgency in ('normal', 'urgent')),
  area text not null,
  status text not null default 'requested' check (status in (
    'requested', 'matched', 'in_progress', 'completed', 'cancelled'
  )),
  estimated_cost_min integer,
  estimated_cost_max integer,
  final_cost integer,
  payment_method text check (payment_method in ('mpesa', 'card', 'cash')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table jobs enable row level security;

create policy "jobs: customer reads own"
  on jobs for select
  using (auth.uid() = customer_id);

create policy "jobs: fundi reads open jobs"
  on jobs for select
  using (
    status = 'requested'
    and exists (
      select 1 from fundi_profiles fp
      where fp.id = auth.uid()
        and fp.verification_status = 'verified'
        and fp.category = jobs.category
    )
  );

create policy "jobs: assigned fundi reads own"
  on jobs for select
  using (auth.uid() = fundi_id);

create policy "jobs: customer inserts own"
  on jobs for insert
  with check (auth.uid() = customer_id);

create policy "jobs: customer updates own"
  on jobs for update
  using (auth.uid() = customer_id);

create policy "jobs: assigned fundi updates own"
  on jobs for update
  using (auth.uid() = fundi_id);

-- ============ reviews ============
create table reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references jobs(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

alter table reviews enable row level security;

create policy "reviews: read if part of the job"
  on reviews for select
  using (
    exists (
      select 1 from jobs j
      where j.id = reviews.job_id
        and (j.customer_id = auth.uid() or j.fundi_id = auth.uid())
    )
  );

create policy "reviews: customer inserts for own completed job"
  on reviews for insert
  with check (
    exists (
      select 1 from jobs j
      where j.id = reviews.job_id
        and j.customer_id = auth.uid()
        and j.status = 'completed'
    )
  );

-- ============ storage buckets ============
insert into storage.buckets (id, name, public)
values
  ('verification-docs', 'verification-docs', false),
  ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

create policy "verification-docs: owner read"
  on storage.objects for select
  using (bucket_id = 'verification-docs' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "verification-docs: owner upload"
  on storage.objects for insert
  with check (bucket_id = 'verification-docs' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "job-photos: owner read"
  on storage.objects for select
  using (bucket_id = 'job-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "job-photos: owner upload"
  on storage.objects for insert
  with check (bucket_id = 'job-photos' and auth.uid()::text = (storage.foldername(name))[1]);

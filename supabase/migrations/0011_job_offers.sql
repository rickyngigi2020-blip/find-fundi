-- Automatic matching: customers no longer pick a fundi.
-- The API offers a job to one fundi at a time, best candidate first. Each
-- offer is accepted, declined, or left to expire, and the job then moves on
-- to the next candidate.

create table job_offers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  fundi_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  -- A fundi gets one shot per job: once they decline or let it lapse, the job
  -- does not come back round to them.
  unique (job_id, fundi_id)
);

create index job_offers_fundi_pending_idx on job_offers (fundi_id, status);
create index job_offers_job_idx on job_offers (job_id);

-- Only the API (service role) reads or writes offers, the same as
-- push_subscriptions in migration 0009. Fundis receive their offer through
-- the API, which decides what they are allowed to see of the job.
alter table job_offers enable row level security;
revoke all on job_offers from anon, authenticated;

-- Records that a job ran out of candidates, so the customer can be told
-- nobody is available rather than waiting forever on a silent screen.
alter table jobs add column search_exhausted_at timestamptz;

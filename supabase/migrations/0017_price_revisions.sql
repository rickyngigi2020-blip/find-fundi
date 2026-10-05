-- Real jobs do not hold still at one price. A fundi opens up a wall, finds the
-- pipe is worse than it looked, and has to buy parts and come back. The old
-- model had one number agreed before work started and no way to change it, so
-- the fundi either guessed high, ate the loss, or argued on the doorstep.
--
-- A revision is a new price with a reason, which the customer has to accept
-- before work goes on. Every one is kept, so the whole history of a price is
-- visible to admins and neither side can quietly rewrite it.

create table job_price_changes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  fundi_id uuid not null references profiles(id) on delete cascade,
  -- What the customer had already agreed, kept alongside so a revision can be
  -- read on its own without replaying the job.
  previous_amount integer not null,
  amount integer not null check (amount > 0),
  reason text not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  declined_at timestamptz,
  -- A revision is answered once.
  check (accepted_at is null or declined_at is null)
);

create index job_price_changes_job_idx on job_price_changes (job_id, created_at desc);

alter table job_price_changes enable row level security;
revoke all on job_price_changes from anon, authenticated;

-- A job paused while the fundi fetches parts. Without this the customer sees a
-- job that has sat untouched for two days and assumes they have been forgotten.
alter table jobs add column materials_since timestamptz;
alter table jobs add column materials_note text;
alter table jobs add column materials_expected_back timestamptz;

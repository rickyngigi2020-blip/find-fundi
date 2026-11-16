-- Commission ledger. When a fundi completes a job that was paid straight to
-- them (cash or M-Pesa), Find Fundi's commission on the agreed price is
-- recorded here and falls due 6 days later. The fundi sees what they owe in a
-- wallet; a commission left unpaid past its due date stops job offers until it
-- is paid (see src/services/commissionService.js).

-- The first 50 fundis Find Fundi approves pay no commission on their first 7
-- jobs. Fundis already approved count, oldest first, up to the 50.
alter table fundi_profiles add column founding_member boolean not null default false;

update fundi_profiles set founding_member = true
 where id in (
   select id from fundi_profiles
    where verification_status = 'verified'
    order by created_at asc
    limit 50
 );

create table commissions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references jobs(id) on delete cascade,
  fundi_id uuid not null references profiles(id) on delete cascade,
  amount integer not null check (amount > 0),
  rate numeric(4,3) not null check (rate > 0 and rate < 1),
  due_at timestamptz not null,
  paid boolean not null default false,
  paid_at timestamptz,
  method text check (method in ('mpesa', 'cash', 'bank')),
  -- Set when the fundi says they have paid and sends the M-Pesa code, so admins
  -- are alerted. It does not lift the lock: only an admin confirming does.
  claimed_at timestamptz,
  claim_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (paid = (paid_at is not null))
);

create index commissions_fundi_open_idx on commissions (fundi_id, paid, due_at);

-- Only the API (service role) reads or writes the ledger.
alter table commissions enable row level security;

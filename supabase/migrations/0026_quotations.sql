-- Quotations. A price used to be one number and a note, and a change to it was
-- another number and a reason. Customers could not see what they were paying
-- for, so fundis sent their real breakdown on WhatsApp and added charges as loose
-- messages ("add labour @3k", "total 13,050") that nobody could check later.
--
-- A quotation is now a list of lines: the fixed-rate service (if the job is on
-- the menu) plus labour, parts, transport or anything else, each with its own
-- amount. Every version is kept, before and after the customer accepts, so the
-- customer can see what was added since they agreed, and admins can see how a
-- price moved and why.
--
-- jobs.quote_amount, quote_note, quoted_at, final_cost, service_rate_id and
-- service_name stay as the summary the rest of the app reads. job_price_changes
-- is no longer written to; its rows are copied in below and the table is kept
-- as it was.

create table job_quotations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  fundi_id uuid not null references profiles(id) on delete cascade,
  -- 1, 2, 3… per job, in the order they were sent.
  version integer not null check (version > 0),
  -- 'quote' is sent before the customer accepts a price; 'update' after.
  stage text not null check (stage in ('quote', 'update')),
  -- [{ id, kind, description, qty, unit, amount, locked }], checked by the API
  -- (src/utils/quoteItems.js). amount is the line total in whole shillings.
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  total integer not null check (total > 0 and total <= 10000000),
  -- Update only: the agreed total it would replace.
  previous_total integer,
  -- Quote: optional note. Update: the reason, which is required.
  note text,
  service_rate_id uuid references service_rates(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  declined_at timestamptz,
  -- A quote the fundi changed before the customer answered it.
  replaced_at timestamptz,
  unique (job_id, version),
  check (num_nonnulls(accepted_at, declined_at, replaced_at) <= 1),
  check (stage = 'quote' or previous_total is not null)
);

create index job_quotations_job_idx on job_quotations (job_id, version);

-- Only the API (service role) reads or writes quotations, as with jobs.
alter table job_quotations enable row level security;
revoke all on job_quotations from anon, authenticated;

-- ---------- copy what already exists ----------

-- (a) The price each job already has becomes its first quotation.
insert into job_quotations (job_id, fundi_id, version, stage, items, total, note, service_rate_id, created_at, accepted_at)
select j.id, j.fundi_id, 1, 'quote',
       jsonb_build_array(
         case when j.service_rate_id is not null
           then jsonb_build_object('id', 'service', 'kind', 'service',
                  'description', coalesce(j.service_name, 'Listed service'),
                  'amount', j.quote_amount, 'locked', true)
           else jsonb_build_object('id', 'line1', 'kind', 'other',
                  'description', coalesce(j.service_name, 'Price for the job'),
                  'amount', j.quote_amount)
         end),
       j.quote_amount, j.quote_note, j.service_rate_id,
       coalesce(j.quoted_at, j.created_at), j.quote_accepted_at
  from jobs j
 where j.quote_amount is not null
   and j.fundi_id is not null;

-- (b) Each earlier price revision becomes the next version, in order.
insert into job_quotations (job_id, fundi_id, version, stage, items, total, previous_total, note, created_at, accepted_at, declined_at)
select c.job_id, c.fundi_id,
       1 + row_number() over (partition by c.job_id order by c.created_at),
       'update',
       jsonb_build_array(jsonb_build_object('id', 'revised', 'kind', 'other',
         'description', 'Revised price', 'amount', c.amount)),
       c.amount, c.previous_amount, c.reason, c.created_at, c.accepted_at, c.declined_at
  from job_price_changes c
 where exists (select 1 from job_quotations q where q.job_id = c.job_id and q.version = 1);

-- ---------- check ----------
-- All good: jobs_with_price_but_no_quotation = 0, price_changes_not_copied = 0.
select
  (select count(*) from jobs j
    where j.quote_amount is not null and j.fundi_id is not null
      and not exists (select 1 from job_quotations q where q.job_id = j.id)) as jobs_with_price_but_no_quotation,
  (select count(*) from job_price_changes) - (select count(*) from job_quotations where stage = 'update') as price_changes_not_copied;

-- Price is agreed after the fundi has talked to the customer: the fundi sends a
-- quote, the customer accepts it and picks how to pay.

alter table jobs add column quote_amount integer check (quote_amount is null or quote_amount > 0);
alter table jobs add column quote_note text;
alter table jobs add column quoted_at timestamptz;
alter table jobs add column quote_accepted_at timestamptz;

-- Jobs are now written only by the API, which checks who may change what.
-- These policies let signed-in users edit any column of their own job rows
-- directly (e.g. a customer rewriting a quote), so they are removed.
-- Reading jobs is unchanged.
drop policy "jobs: customer inserts own" on jobs;
drop policy "jobs: customer updates own" on jobs;
drop policy "jobs: assigned fundi updates own" on jobs;

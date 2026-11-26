-- Run straight after deploying 1.7, once, after 0026.
--
-- Between running 0026 and the deploy, the live site still ran the old code,
-- which writes a price only to jobs.quote_* and never to job_quotations. This
-- copies each of those prices in as the job's first quotation, the same way
-- 0026 did for older ones. Jobs that already have a quotation are left alone,
-- so running it twice changes nothing.

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
   and j.fundi_id is not null
   and not exists (select 1 from job_quotations q where q.job_id = j.id);

-- Price changes the old code wrote in the same gap (to job_price_changes, after
-- the job's latest quotation) become the next versions, as in 0026.
insert into job_quotations (job_id, fundi_id, version, stage, items, total, previous_total, note, created_at, accepted_at, declined_at)
select c.job_id, c.fundi_id,
       latest.version + row_number() over (partition by c.job_id order by c.created_at),
       'update',
       jsonb_build_array(jsonb_build_object('id', 'revised', 'kind', 'other',
         'description', 'Revised price', 'amount', c.amount)),
       c.amount, c.previous_amount, c.reason, c.created_at, c.accepted_at, c.declined_at
  from job_price_changes c
  join lateral (
    select max(q.version) as version, max(q.created_at) as created_at
      from job_quotations q where q.job_id = c.job_id
  ) latest on latest.version is not null
 where c.created_at > latest.created_at;

-- ---------- check ----------
-- All good: jobs_with_price_but_no_quotation = 0, price_changes_not_copied = 0.
select
  (select count(*) from jobs j
    where j.quote_amount is not null and j.fundi_id is not null
      and not exists (select 1 from job_quotations q where q.job_id = j.id)) as jobs_with_price_but_no_quotation,
  (select count(*) from job_price_changes c
    where c.created_at > (select max(q.created_at) from job_quotations q where q.job_id = c.job_id and q.stage = 'quote')
      and not exists (select 1 from job_quotations q where q.job_id = c.job_id and q.stage = 'update' and q.created_at = c.created_at)) as price_changes_not_copied;

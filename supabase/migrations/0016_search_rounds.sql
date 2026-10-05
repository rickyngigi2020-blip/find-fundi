-- The search no longer gives up. Offering every fundi once and stopping left
-- the customer with a dead end and a button to press; instead the job goes
-- round again, and again, until someone takes it or the customer cancels.
--
-- A round is one pass through everyone who could do the job. A fundi gets one
-- offer per round, so passing does not mean never seeing it again, it means
-- not seeing it until the next pass.

alter table job_offers add column round integer not null default 1;

alter table job_offers drop constraint job_offers_job_id_fundi_id_key;
alter table job_offers add constraint job_offers_job_fundi_round_key unique (job_id, fundi_id, round);

alter table jobs add column search_round integer not null default 1;

-- search_exhausted_at now means something stronger than before: not "everyone
-- passed", but "there is nobody in this category who could ever take it".
comment on column jobs.search_exhausted_at is
  'Set when no verified fundi exists for this category at all, not merely when the current round found nobody free.';

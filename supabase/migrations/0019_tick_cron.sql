-- The search for a fundi only moved when the customer's page asked, or when
-- GitHub's scheduler got round to it: every 10 minutes at best, often later.
-- Offers last 90 seconds, so a customer who closed the page could wait a
-- quarter of an hour for the next fundi to be asked.
--
-- Supabase's own scheduler (pg_cron, free tier) now calls the tick every
-- minute, through pg_net. The GitHub workflow stays as a backup and to keep
-- the project from pausing.
--
-- Only https://www.findfundi.com, never a vercel.app address: the old
-- addresses answer with a redirect, which pg_net does not follow.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Running this again replaces the job of the same name rather than adding a
-- second one. The tick can take several seconds when many jobs are waiting,
-- so pg_net is given 30 instead of its default of 1.
select cron.schedule(
  'find-fundi-tick',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://www.findfundi.com/api/v1/tick',
       timeout_milliseconds := 30000
     ) $$
);

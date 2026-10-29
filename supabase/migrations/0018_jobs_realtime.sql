-- Customers and fundis had to refresh to see a job change: a fundi taking the
-- job, a price being sent or accepted, a cancellation. Supabase Realtime only
-- streams tables added to its publication, so add jobs, the same as
-- fundi_locations in migration 0004.
--
-- Nothing new is exposed. Realtime applies the same row level security as a
-- normal read, so each person only receives changes to jobs they could already
-- select: their own as customer, their own as booked fundi, and the open ones
-- fundis can already see. The page uses the event only as a signal to reload
-- through the API.

alter publication supabase_realtime add table jobs;

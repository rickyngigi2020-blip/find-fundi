-- Fundi app, part 1: online/offline availability, and when each job was
-- completed so earnings can be counted per day and week.

-- A fundi counts as available to customers only while is_online is set and
-- their fundi app has checked in recently (last_seen_at). Closing the app
-- without going offline therefore stops showing them as available.
alter table fundi_profiles add column is_online boolean not null default false;
alter table fundi_profiles add column last_seen_at timestamptz;

alter table jobs add column completed_at timestamptz;
update jobs set completed_at = updated_at where status = 'completed';

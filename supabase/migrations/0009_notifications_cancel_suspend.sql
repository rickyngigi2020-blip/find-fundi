-- Browser notifications, cancelling jobs, and suspending accounts.

-- ============ push subscriptions ============
-- One row per browser that turned on notifications. Only the API (service
-- role) reads or writes these, so there are no policies and no user grants.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_id_idx on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
revoke all on push_subscriptions from anon, authenticated;

-- ============ cancelled jobs ============
-- status 'cancelled' already exists; these record who cancelled and why.
-- A fundi turning a job down doesn't cancel it: it goes back to 'requested'.
alter table jobs add column cancelled_at timestamptz;
alter table jobs add column cancelled_by text check (cancelled_by in ('customer', 'admin'));
alter table jobs add column cancel_reason text;

-- ============ suspended accounts ============
-- Set by admins through the API only: it is not in the user-editable column
-- grants from migration 0008. The API also bans the user in Supabase Auth.
alter table profiles add column suspended_at timestamptz;

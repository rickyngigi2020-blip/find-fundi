-- Fundi identity checks: a selfie and a KRA PIN join the national ID and ID
-- document already collected. Both columns are nullable so fundis who were
-- verified before this release are not broken; the API requires them for every
-- new application.

alter table fundi_profiles add column kra_pin text;
alter table fundi_profiles add column selfie_path text;

alter table fundi_profiles add constraint fundi_profiles_kra_pin_format
  check (kra_pin is null or kra_pin ~ '^[AP][0-9]{9}[A-Z]$');

-- Selfies live in their own private bucket. A fundi may upload into their own
-- folder, and that is all: there is deliberately no select, update or delete
-- policy, so nobody can read a selfie back with the anon or user key. Admins
-- see it through short-lived signed links made with the service role.
insert into storage.buckets (id, name, public)
values ('fundi-identity', 'fundi-identity', false)
on conflict (id) do nothing;

create policy "fundi-identity: upload own"
  on storage.objects for insert
  with check (bucket_id = 'fundi-identity' and auth.uid()::text = (storage.foldername(name))[1]);

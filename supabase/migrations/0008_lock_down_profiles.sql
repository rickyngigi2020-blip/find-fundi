-- Lock down profiles and fundi applications.
--
-- Before this, any signed-in user could, straight from the browser:
--   * read a verified fundi's phone, street, national ID and ID document paths
--     (the two "read verified" policies exposed whole rows, not just the
--     columns the booking page shows);
--   * set is_admin = true on their own profile;
--   * set verification_status = 'verified' on their own fundi application.
--
-- The API now does the fundi search and fundi applications with the service
-- role and returns only safe columns, so users need no direct access beyond
-- their own profile's everyday fields.

-- ============ reading other people's rows ============
drop policy "profiles: read if verified fundi" on profiles;
drop policy "fundi_profiles: read verified (for matching)" on fundi_profiles;

-- ============ profiles: only everyday fields are user-editable ============
-- RLS limits users to their own row; these grants limit which columns.
-- is_admin and created_at are left out, so only the service role (the admin
-- side) can change them.
revoke insert, update on profiles from anon, authenticated;
grant insert (id, full_name, phone, role, area, street, avatar_url, updated_at) on profiles to authenticated;
-- id is included because upsert rewrites it to the same value; the
-- "update own" policy still stops it being changed to anyone else's.
grant update (id, full_name, phone, role, area, street, avatar_url, updated_at) on profiles to authenticated;

-- ============ fundi_profiles: written only by the API ============
-- Applying, verification and online status all go through the API, which
-- decides what may change. Users keep read access to their own row.
revoke insert, update, delete on fundi_profiles from anon, authenticated;
drop policy "fundi_profiles: insert own" on fundi_profiles;
drop policy "fundi_profiles: update own" on fundi_profiles;

-- Lets any authenticated user read the basic profile info (name, area) of a
-- fundi who has been verified, so the job-matching list can show who they are.

create policy "profiles: read if verified fundi"
  on profiles for select
  using (
    exists (
      select 1 from fundi_profiles fp
      where fp.id = profiles.id
        and fp.verification_status = 'verified'
    )
  );

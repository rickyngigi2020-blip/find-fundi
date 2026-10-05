-- Applicants without papers were asked to write how they learned the trade.
-- That is a barrier for anyone who does not read or write comfortably, which
-- is exactly the group this route exists for. Ticking the box is now enough,
-- and the interview is where their skill is actually judged.

alter table fundi_profiles drop constraint fundi_profiles_qualification_check;

alter table fundi_profiles add column no_certificate boolean not null default false;

-- Anyone who already came in through the written route keeps that standing.
update fundi_profiles
   set no_certificate = true
 where no_certificate_reason is not null;

-- Still one or the other, but no writing required.
alter table fundi_profiles add constraint fundi_profiles_qualification_check check (
  array_length(certificate_paths, 1) is not null
  or no_certificate
);

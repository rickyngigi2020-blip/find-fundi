-- Not every good fundi has papers. Many learned on the job and hold nothing
-- formal. Those applicants explain their experience instead of attaching a
-- certificate, Find Fundi interviews them and watches them work, and we issue
-- our own certification.

-- Why they have no certificate, in their own words. Required when they attach
-- none; the API enforces one or the other.
alter table fundi_profiles add column no_certificate_reason text;

-- Set by an admin after the interview. A fundi certified this way counts as
-- qualified, exactly like one who uploaded papers.
alter table fundi_profiles add column certified_by_find_fundi_at timestamptz;
alter table fundi_profiles add column certified_by uuid references profiles(id) on delete set null;
alter table fundi_profiles add column certification_note text;

-- An application has to show qualification one way or the other: uploaded
-- certificates, or a written explanation that leads to an interview.
alter table fundi_profiles add constraint fundi_profiles_qualification_check check (
  array_length(certificate_paths, 1) is not null
  or no_certificate_reason is not null
);

-- Fundi applications now carry proof of trade: an ID and one or more
-- certificates showing the applicant is a professional in the category they
-- are applying for. Both are PDFs, checked on upload and in the API.

-- A fundi can hold several certificates (trade test, NITA, a manufacturer
-- course), so one text column is no longer enough.
alter table fundi_profiles add column certificate_paths text[] not null default '{}';

-- Carry over the single certificate applications already hold, so nobody has
-- to reapply.
update fundi_profiles
   set certificate_paths = array[certificate_url]
 where certificate_url is not null and certificate_url <> '';

alter table fundi_profiles drop column certificate_url;

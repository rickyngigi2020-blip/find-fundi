-- The fundi application was the step the stress-test technician found most
-- tiring. "Highest qualification" offered Bachelor's and Master's degrees to
-- people whose proof of trade is a trade test or an apprenticeship, and the
-- certificates themselves already show it, so the form no longer asks.
-- Applications made before keep what they gave.
--
-- Run this before deploying the API change, or new applications are refused
-- by the database.

alter table fundi_profiles alter column highest_qualification drop not null;

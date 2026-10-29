-- Booking now takes two taps: pick the trade, then Find a fundi. Typing a
-- description or recording a voice note is still offered, but no longer
-- required. The fundi calls the customer before sending a price, which is
-- where the job gets explained anyway, and the stress test showed every extra
-- step loses people who are not at ease with a smartphone.
--
-- Run this before deploying the API change, or bookings with no details are
-- refused by the database.

alter table jobs drop constraint if exists jobs_description_or_voice_note;

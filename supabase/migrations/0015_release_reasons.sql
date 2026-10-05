-- A fundi turning a job down now has to say why, from a short list. The reason
-- stays on their offer row, so a job that goes back out keeps the history of
-- who passed on it and what they said.

alter table job_offers add column release_reason text;
alter table job_offers add column release_note text;
alter table job_offers add column released_at timestamptz;

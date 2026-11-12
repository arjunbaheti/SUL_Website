-- 2026-11-12: conflict of interest. A reviewer who knows an applicant can declare it;
-- it's stored as vote = 'conflict', replaces their screening vote and isn't counted.
alter table public.application_votes drop constraint if exists application_votes_vote_chk;
alter table public.application_votes
  add constraint application_votes_vote_chk check (vote in ('yes','maybe','no','conflict'));

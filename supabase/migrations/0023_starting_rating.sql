-- A new fundi has no reviews, so an admin gives them a starting rating when
-- they approve the application. Customer reviews then move the rating up or
-- down (see src/services/fundiCardService.js: the starting rating counts as a
-- few reviews' worth, so real reviews take over as they arrive).
-- Nullable so fundis approved before this release are not affected.

alter table fundi_profiles add column starting_rating numeric(2,1)
  check (starting_rating is null or (starting_rating >= 1 and starting_rating <= 5));

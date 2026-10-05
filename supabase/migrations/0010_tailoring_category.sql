-- Adds tailoring and sewing as a service category.
-- Torn clothes, alterations, and garments made to order (kitenge and similar).

alter table fundi_profiles drop constraint fundi_profiles_category_check;

alter table fundi_profiles add constraint fundi_profiles_category_check check (category in (
  'phone_electronics', 'computer_laptop', 'appliance', 'mechanical',
  'general_maintenance', 'installation', 'tailoring'
));

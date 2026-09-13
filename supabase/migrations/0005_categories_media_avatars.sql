-- Category restructure, voice notes + photos on jobs, and profile pictures.

-- ============ categories ============
alter table fundi_profiles drop constraint fundi_profiles_category_check;

update fundi_profiles set category = 'general_maintenance' where category = 'electrical';
update jobs set category = 'general_maintenance' where category = 'electrical';

alter table fundi_profiles add constraint fundi_profiles_category_check check (category in (
  'phone_electronics', 'computer_laptop', 'appliance', 'mechanical', 'general_maintenance', 'installation'
));

-- ============ voice notes + photos ============
alter table jobs alter column description drop not null;
alter table jobs add column photo_paths text[] not null default '{}';
alter table jobs add column voice_note_path text;
alter table jobs add constraint jobs_description_or_voice_note check (
  description is not null or voice_note_path is not null
);

insert into storage.buckets (id, name, public)
values ('job-media', 'job-media', false)
on conflict (id) do nothing;

create policy "job-media: owner upload"
  on storage.objects for insert
  with check (bucket_id = 'job-media' and auth.uid()::text = (storage.foldername(name))[1]);

-- Readable by the customer who uploaded it, the fundi assigned to the job, and
-- verified fundis in the job's category while it is still open. The jobs
-- subquery runs under the reader's own jobs RLS, which already scopes it.
create policy "job-media: read"
  on storage.objects for select
  using (
    bucket_id = 'job-media' and (
      auth.uid()::text = (storage.foldername(name))[1]
      or exists (
        select 1 from public.jobs j
        where (j.voice_note_path = objects.name or objects.name = any (j.photo_paths))
          and (
            j.fundi_id = auth.uid()
            or (
              j.status = 'requested'
              and exists (
                select 1 from public.fundi_profiles fp
                where fp.id = auth.uid()
                  and fp.verification_status = 'verified'
                  and fp.category = j.category
              )
            )
          )
      )
    )
  );

-- ============ profile pictures ============
alter table profiles add column avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars: owner read"
  on storage.objects for select
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "avatars: owner upload"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "avatars: owner delete"
  on storage.objects for delete
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

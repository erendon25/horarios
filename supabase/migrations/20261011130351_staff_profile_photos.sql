-- Self-service avatars; no changes to the personnel self-service write API.
create table public.staff_profile_photos (
 staff_id uuid primary key references public.staff_profiles(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 store_id uuid not null references public.stores(id),
 object_path text not null unique,
 updated_at timestamptz not null default clock_timestamp(),
 check (object_path = user_id::text || '/profile.jpg')
);
create index staff_profile_photos_user_idx on public.staff_profile_photos(user_id);
create index staff_profile_photos_store_idx on public.staff_profile_photos(store_id);
alter table public.staff_profile_photos enable row level security;
revoke all on public.staff_profile_photos from public, anon, authenticated;
grant select on public.staff_profile_photos to authenticated;
create policy staff_profile_photos_read on public.staff_profile_photos
for select to authenticated using (
 (select private.current_user_role()) is not null and (
  (user_id = (select auth.uid()) and staff_id = (select private.current_staff_profile_id()))
  or (select private.current_user_role()) = 'superadmin'
  or (store_id = (select private.current_user_store_id()) and (
   (select private.current_user_role()) = 'admin'
   or exists (
    select 1 from public.competition_team_members m
    where m.staff_id = staff_profile_photos.staff_id
   )
  ))
 )
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('profile-photos','profile-photos',false,2097152,array['image/webp','image/jpeg','image/png']);

create policy profile_photos_read on storage.objects for select to authenticated
using (bucket_id = 'profile-photos' and (select private.current_user_role()) is not null and (
 (storage.foldername(name))[1] = (select auth.uid())::text
 or exists (select 1 from public.staff_profile_photos p where p.object_path = name)
));
create policy profile_photos_insert on storage.objects for insert to authenticated
with check (bucket_id = 'profile-photos'
 and (select private.current_user_role()) is not null
 and (select private.current_staff_profile_id()) is not null
 and name = (select auth.uid())::text || '/profile.jpg'
 and owner_id = (select auth.uid())::text
);
create policy profile_photos_update on storage.objects for update to authenticated
using (bucket_id='profile-photos'
 and (select private.current_user_role()) is not null
 and (select private.current_staff_profile_id()) is not null
 and name=(select auth.uid())::text || '/profile.jpg'
 and owner_id=(select auth.uid())::text
)
with check (bucket_id='profile-photos'
 and (select private.current_user_role()) is not null
 and (select private.current_staff_profile_id()) is not null
 and name=(select auth.uid())::text || '/profile.jpg'
 and owner_id=(select auth.uid())::text
);
create policy profile_photos_delete on storage.objects for delete to authenticated
using (bucket_id = 'profile-photos'
 and (select private.current_user_role()) is not null
 and (storage.foldername(name))[1] = (select auth.uid())::text
 and owner_id = (select auth.uid())::text
);
-- One object per account. Replacements preserve signed URLs in other open tabs.

create function private.set_own_profile_photo(p_object_path text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_staff uuid := private.current_staff_profile_id();
 v_store uuid := private.current_user_store_id();
 v_user uuid := auth.uid();
 v_previous text;
 v_today date := (clock_timestamp() at time zone 'America/Lima')::date;
begin
 if v_user is null or private.current_user_role() is null or v_staff is null then
  raise exception 'La cuenta no tiene un colaborador vigente vinculado' using errcode='42501';
 end if;
 perform 1 from public.staff_profiles s where s.id=v_staff and s.store_id=v_store
  and s.status in ('active','pending')
  and (s.cessation_date is null or s.cessation_date >= v_today)
  and (not coalesce(s.is_trainee,false) or s.training_end_date is null or s.training_end_date >= v_today)
  for update;
 if not found then raise exception 'Perfil no disponible para cambiar la foto' using errcode='42501'; end if;
 select object_path into v_previous from public.staff_profile_photos where staff_id=v_staff;
 if p_object_path is null then
  delete from public.staff_profile_photos where staff_id=v_staff;
 else
  if p_object_path <> v_user::text || '/profile.jpg' then
   raise exception 'La foto debe pertenecer a tu cuenta' using errcode='42501';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='profile-photos'
    and name=p_object_path and owner_id=v_user::text) then
   raise exception 'Primero sube la foto a tu cuenta';
  end if;
  insert into public.staff_profile_photos(staff_id,user_id,store_id,object_path)
  values(v_staff,v_user,v_store,p_object_path)
  on conflict(staff_id) do update set user_id=excluded.user_id,store_id=excluded.store_id,
   object_path=excluded.object_path,updated_at=clock_timestamp();
 end if;
 return jsonb_build_object('staff_id',v_staff,'object_path',p_object_path,'previous_path',v_previous);
end;
$$;
revoke all on function private.set_own_profile_photo(text) from public,anon;
grant execute on function private.set_own_profile_photo(text) to authenticated;
create function public.set_own_profile_photo(p_object_path text default null)
returns jsonb language sql security invoker set search_path = '' as $$
 select private.set_own_profile_photo(p_object_path);
$$;
revoke all on function public.set_own_profile_photo(text) from public,anon;
grant execute on function public.set_own_profile_photo(text) to authenticated;
notify pgrst, 'reload schema';
